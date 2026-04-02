const { createLogger, format, transports } = require('winston');
const fs = require('fs');
const path = require('path');

fs.mkdirSync(path.join(process.cwd(), 'logs'), { recursive: true });

const logger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.errors({ stack: true }),
    format.json()
  ),
  defaultMeta: { service: 'battlenix-api' },
  transports: [
    // Console — readable for dev
    new transports.Console({
      format: format.combine(
        format.colorize(),
        format.printf(({ timestamp, level, message, service, ...meta }) => {
          const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
          return `${timestamp} [${level}] ${message}${metaStr}`;
        })
      ),
    }),
    // File — info level and above
    new transports.File({
      filename: path.join('logs', 'combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    // File — errors only
    new transports.File({
      filename: path.join('logs', 'error.log'),
      level: 'error',
      maxsize: 5242880,
      maxFiles: 5,
    }),
  ],
});

module.exports = logger;
