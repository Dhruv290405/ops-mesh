import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { app: 'opsmesh-worker' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: ['*.apiKey', '*.password', '*.token'],
    censor: '[REDACTED]'
  },
  transport:
    process.env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } }
      : undefined
});