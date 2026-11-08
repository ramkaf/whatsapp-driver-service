import type { AuthStateService } from '../../auth-state/providers/auth-state.service.ts';
import type { SessionRepository } from '../../sessions/session.repository.ts';
import type { SocketFactoryService } from '../providers/socket/socket-factory.service.ts';

export interface SessionPersistence extends Pick<
  SessionRepository,
  'require' | 'update' | 'transition' | 'recoverable' | 'remove'
> {}

export interface SessionAuthentication extends Pick<
  AuthStateService,
  'open' | 'clear' | 'hasIdentity'
> {}

export interface SessionSocketFactory extends Pick<
  SocketFactoryService,
  'create'
> {}
