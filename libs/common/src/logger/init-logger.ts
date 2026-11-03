import afraLogger from '@afra/exchange-logger';
import { afraLoggerConfiguer } from '../config/afra-logger-configuer.ts';

export const InitAfraLogger = () =>
  afraLogger.start({
    apm: {
      ...afraLoggerConfiguer(),
      active: true,
      captureBody: 'off',
    },
    logger: {
      file: { enabled: false },
    },
    rabbitmq: {
      enabled: true,
    },
  });
