import type { AuthStateService } from '../../auth-state/providers/auth-state.service.ts';
import type { IWaSessionRepository } from '@libs/prisma';
import type { SocketFactoryService } from '../providers/socket/socket-factory.service.ts';

export interface SessionPersistence extends Pick<
  IWaSessionRepository,
  | 'require'
  | 'updateCurrent'
  | 'transition'
  | 'recoverable'
  | 'remove'
  | 'currentByPhone'
  | 'countEnabledSessions'
  | 'replaceCurrent'
> {}

export interface SessionAuthentication extends Pick<
  AuthStateService,
  'open' | 'clear' | 'hasIdentity'
> {}

export interface SessionSocketFactory extends Pick<
  SocketFactoryService,
  'create' | 'release'
> {}
