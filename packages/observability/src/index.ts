import pino, { type Logger } from 'pino';

export function createLogger(level = 'info'): Logger {
  return pino({
    level,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.x-hub-signature-256',
        '*.accessToken',
        '*.appSecret',
        '*.phone',
        '*.email'
      ],
      censor: '[REDACTED]'
    },
    base: { service: 'fanpage-sales-agent' },
    timestamp: pino.stdTimeFunctions.isoTime
  });
}

export type { Logger };
