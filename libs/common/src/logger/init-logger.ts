import afraLogger from '@afra/exchange-logger';
import { afraLoggerConfigure } from '../config/afra-logger-configure.ts';

export const InitAfraLogger = () =>
  afraLogger.start({
    apm: {
      ...afraLoggerConfigure(),
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
