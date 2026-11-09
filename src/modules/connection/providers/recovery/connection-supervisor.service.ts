import { Injectable } from '@nestjs/common';

// Calculates bounded reconnect delays with jitter and controlled restart timing.
@Injectable()
export class ConnectionSupervisorService {
  next(retries: number, restartRequired = false): number {
    // Only the first protocol restart is fast; repeated restarts must back off.
    if (restartRequired && retries === 0) return 250;
    return Math.floor(
      Math.min(60000, 1000 * 2 ** Math.min(retries, 16)) *
        (0.5 + Math.random() * 0.5),
    );
  }
}
