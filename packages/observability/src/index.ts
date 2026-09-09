import pino, { type Logger } from 'pino';
export {
  createOperationalMetrics,
  type MetricLogger,
  type OperationalMetricName,
  type OperationalMetrics
} from './metrics.js';

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
