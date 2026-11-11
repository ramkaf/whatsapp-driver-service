import { ConnectionMessageSource } from '../interfaces/message-event-source.ts';
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { Provider } from '@nestjs/common';
import { configuer } from '@libs/common';
import { ConnectionModule } from '../connection.module.ts';
import { SessionManagerService } from '../providers/session/session-manager.service.ts';
import { RealtimeService } from '../providers/realtime/realtime.service.ts';
import { AuthStateService } from '../../auth-state/providers/auth-state.service.ts';
import { WA_SESSION_REPOSITORY } from '@libs/prisma';

describe('ConnectionModule', () => {
  it('resolves its declared providers using the external authentication and persistence contracts', async () => {
    const providers = Reflect.getMetadata(
      'providers',
      ConnectionModule,
    ) as Provider[];
    const module = await Test.createTestingModule({
      providers: [
        ...providers,
        { provide: configuer.KEY, useValue: { whatsapp: {} } },
        { provide: AuthStateService, useValue: {} },
        { provide: WA_SESSION_REPOSITORY, useValue: {} },
      ],
    }).compile();
    try {
      expect(module.get(SessionManagerService)).toBeInstanceOf(
        SessionManagerService,
      );
      expect(module.get(RealtimeService)).toBeInstanceOf(RealtimeService);
      expect(Reflect.getMetadata('exports', ConnectionModule)).toEqual([
        SessionManagerService,
        RealtimeService,
        ConnectionMessageSource,
      ]);
    } finally {
      await module.close();
    }
  });
});
