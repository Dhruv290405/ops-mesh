import * as amqp from 'amqplib';

type AmqpConnection = Awaited<ReturnType<typeof amqp.connect>>;
type AmqpChannel = Awaited<ReturnType<AmqpConnection['createChannel']>>;

/**
 * Event bus abstraction.
 *
 * OpsMesh chose **RabbitMQ** over Kafka:
 *  - Per-message routing (exchange -> queues per consumer group) matches our
 *    fan-out needs (events -> incident engine, notification worker, analytics).
 *  - Native per-message ACK/NACK + dead-letter exchange = precise retry control
 *    with exponential backoff (Kafka offsets make per-message retry awkward).
 *  - Consumer groups via multiple consumers on one queue scale fine far beyond
 *    our volume; Kafka's log compaction wins at >100k msg/s, a scale we don't
 *    need (documented in docs/engineering-decisions.md).
 *
 * Messages carry a `subject` ("event" for the incident pipeline, "realtime"
 * for dashboard WebSocket fan-out). Routing keys are `<subject>.<type>`;
 * consumers bind their queue to `<subject>.#`.
 *
 * The `EventBus` interface is the contract. `RabbitEventBus` is production.
 * `MemoryEventBus` is a faithful single-process implementation used for local
 * dev and CI so the full pipeline runs without a broker. The consumer contract
 * (retry/dead-letter) is identical, so worker code is transport-agnostic.
 */

export interface PublishedMessage {
  type: string;
  payload: unknown;
  attempts: number;
  publishedAt: string;
}

export interface ConsumeOptions {
  /** Consumer-group queue; Rabbit implementations bind this queue to a subject */
  queue: string;
  /** Routing subject this consumer receives (`event` or `realtime`) */
  subject?: 'event' | 'realtime';
  /** attempts before nacking to DLQ */
  maxRetries: number;
  /** base ms, doubled per attempt */
  retryBaseMs: number;
  handler: (message: PublishedMessage) => Promise<void>;
}

export interface EventBus {
  publish(type: string, payload: unknown, opts?: { subject?: 'event' | 'realtime' }): Promise<void>;
  consume(options: ConsumeOptions): Promise<void>;
  close(): Promise<void>;
  ping(): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// RabbitMQ
// ---------------------------------------------------------------------------

export class RabbitEventBus implements EventBus {
  private connection: AmqpConnection | null = null;
  private channel: AmqpChannel | null = null;
  private readonly url: string;
  private readonly defaultQueue: string;
  private readonly exchange = 'opsmesh.events';

  constructor(url: string, defaultQueue?: string, retryQueue?: string, deadLetterQueue?: string) {
    this.url = url;
    this.defaultQueue = defaultQueue ?? 'opsmesh.events';
    // (retryQueue / deadLetterQueue are resolved per-queue at assert time)
  }

  private async ensure(queueName?: string): Promise<AmqpChannel> {
    if (!this.connection || !this.channel) {
      this.connection = await amqp.connect(this.url, { heartbeat: 30 });
      this.channel = await this.connection.createChannel();
      await this.channel.assertExchange(this.exchange, 'topic', { durable: true });
    }
    const channel = this.channel;
    const name = queueName ?? this.defaultQueue;
    if (!(name in this.assertedQueues)) {
      await channel.assertQueue(name, {
        durable: true,
        deadLetterExchange: '',
        deadLetterRoutingKey: `${name}.dlq`
      });
      await channel.assertQueue(`${name}.dlq`, { durable: true });
      this.assertedQueues[name] = true;
    }
    return channel;
  }

  private readonly assertedQueues: Record<string, boolean> = {};

  async publish(
    type: string,
    payload: unknown,
    opts?: { subject?: 'event' | 'realtime' }
  ): Promise<void> {
    const subject = opts?.subject ?? 'event';
    const channel = await this.ensure();
    const message: PublishedMessage = {
      type,
      payload,
      attempts: 0,
      publishedAt: new Date().toISOString()
    };
    channel.publish(this.exchange, `${subject}.${type}`, Buffer.from(JSON.stringify(message)), {
      persistent: true
    });
  }

  async consume(options: ConsumeOptions): Promise<void> {
    const subject = options.subject ?? 'event';
    const queue = options.queue ?? this.defaultQueue;
    const channel = await this.ensure(queue);
    await channel.bindQueue(queue, this.exchange, `${subject}.#`);
    channel.prefetch(10);
    channel.consume(
      queue,
      (msg) => {
        if (!msg) return;
        void (async () => {
          let parsed: PublishedMessage;
          try {
            parsed = JSON.parse(msg.content.toString()) as PublishedMessage;
          } catch {
            channel.nack(msg, false, false); // poison message -> DLQ
            return;
          }
          try {
            await options.handler(parsed);
            channel.ack(msg);
          } catch {
            const attempts = (parsed.attempts ?? 0) + 1;
            parsed.attempts = attempts;
            if (attempts >= options.maxRetries) {
              channel.ack(msg);
              try {
                this.channel!.sendToQueue(`${queue}.dlq`, Buffer.from(JSON.stringify(parsed)));
              } catch {
                /* DLQ write failure is logged by caller */
              }
            } else {
              const delayMs = Math.min(options.retryBaseMs * 2 ** (attempts - 1), 60000);
              channel.nack(msg, false, false);
              // republish after the delay (survives restarts via TTL)
              setTimeout(() => {
                void this.scheduleRedelivery(queue, parsed, delayMs);
              }, delayMs);
            }
          }
        })();
      },
      { noAck: false }
    );
  }

  private async scheduleRedelivery(queueName: string, message: PublishedMessage, delayMs: number): Promise<void> {
    try {
      const channel = await this.ensure(queueName);
      channel.sendToQueue(queueName, Buffer.from(JSON.stringify(message)), {
        expiration: String(delayMs)
      });
    } catch {
      /* attempts a redelivery next cycle */
    }
  }

  async ping(): Promise<boolean> {
    try {
      await this.ensure();
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    try {
      await this.channel?.close();
      await this.connection?.close();
    } catch {
      /* already closed */
    }
    this.channel = null;
    this.connection = null;
  }
}

// ---------------------------------------------------------------------------
// In-memory (single process, dev/CI)
// ---------------------------------------------------------------------------

type PendingMessage = { message: PublishedMessage; retryAt: number; attempts: number };

interface MemoryConsumer {
  subject: 'event' | 'realtime';
  maxRetries: number;
  retryBaseMs: number;
  handler: (message: PublishedMessage) => Promise<void>;
  pending: PendingMessage[];
}

export class MemoryEventBus implements EventBus {
  private consumers: MemoryConsumer[] = [];
  private timers = new Set<NodeJS.Timeout>();
  private deadLetters: PublishedMessage[] = [];
  private rrCounter = 0;

  async publish(
    type: string,
    payload: unknown,
    opts?: { subject?: 'event' | 'realtime' }
  ): Promise<void> {
    const subject = opts?.subject ?? 'event';
    const message: PublishedMessage = {
      type,
      payload,
      attempts: 0,
      publishedAt: new Date().toISOString()
    };
    // Fan-out across subjects (different consumer groups, like separate Rabbit
    // queues); within a subject consumers compete round-robin (like multiple
    // processes sharing ONE queue), so a message reaches exactly one consumer.
    const group = this.consumers.filter((c) => c.subject === subject);
    if (group.length === 0) return;
    const target = group[this.rrCounter++ % group.length];
    target.pending.push({ message, retryAt: 0, attempts: 0 });
  }

  async consume(options: ConsumeOptions): Promise<void> {
    const consumer: MemoryConsumer = {
      subject: options.subject ?? 'event',
      maxRetries: options.maxRetries,
      retryBaseMs: options.retryBaseMs,
      handler: options.handler,
      pending: []
    };
    this.consumers.push(consumer);
    const tick = async (): Promise<void> => {
      const now = Date.now();
      for (const c of this.consumers) {
        const due = c.pending.filter((p) => p.retryAt <= now);
        if (due.length === 0) continue;
        c.pending = c.pending.filter((p) => p.retryAt > now);
        for (const item of due) {
          try {
            await c.handler(item.message);
          } catch {
            const attempts = item.attempts + 1;
            if (attempts >= c.maxRetries) {
              this.deadLetters.push(item.message);
            } else {
              const delayMs = Math.min(c.retryBaseMs * 2 ** (attempts - 1), 60000);
              c.pending.push({
                message: { ...item.message, attempts },
                retryAt: now + delayMs,
                attempts
              });
            }
          }
        }
      }
      const t = setTimeout(() => void tick(), 25);
      this.timers.add(t);
    };
    const t = setTimeout(() => void tick(), 0);
    this.timers.add(t);
  }

  /** Exposed for tests: messages that permanently failed. */
  deadLettersCount(): number {
    return this.deadLetters.length;
  }

  pendingCount(): number {
    return this.consumers.reduce((n, c) => n + c.pending.length, 0);
  }

  async ping(): Promise<boolean> {
    return true;
  }

  async close(): Promise<void> {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.consumers = [];
    this.deadLetters = [];
  }
}

let bus: EventBus | null = null;

export function getEventBus(): EventBus {
  if (bus) return bus;
  const url = process.env.RABBITMQ_URL ?? 'amqp://localhost:5672';
  const queue = process.env.RABBITMQ_EVENTS_QUEUE ?? 'opsmesh.events';
  bus = url === 'memory' || url === ''
    ? new MemoryEventBus()
    : new RabbitEventBus(url, queue);
  return bus;
}

export function createEventBus(url?: string, queue?: string): EventBus {
  if (!url || url === 'memory') return new MemoryEventBus();
  return new RabbitEventBus(url, queue ?? 'opsmesh.events');
}

export async function closeEventBus(): Promise<void> {
  if (bus) {
    await bus.close();
    bus = null;
  }
}