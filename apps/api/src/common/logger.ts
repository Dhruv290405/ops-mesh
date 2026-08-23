import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { app: 'opsmesh' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: ['req.headers.authorization', 'req.headers["x-opsmesh-key"]', '*.password', '*.passwordHash', '*.token'],
    censor: '[REDACTED]'
  },
  transport:
    process.env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } }
      : undefined
});

export type Logger = pino.Logger;

export function childLogger(bindings: Record<string, unknown>): Logger {
  return logger.child(bindings);
}