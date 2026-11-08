import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { configuer } from '@libs/common';
import type { IAppConfig } from '@libs/common';

import type { ConnectionStatusSource } from '../../interfaces/session-results.ts';
export type { ConnectionStatusSource } from '../../interfaces/session-results.ts';

/** Handles realtime authentication, session status polling, and event delivery in one service. */
@Injectable()
export class RealtimeService implements OnModuleDestroy {
  private server?: WebSocketServer;
  private readonly subscriptions = new Map<WebSocket, string>();
  private readonly lastStatus = new Map<WebSocket, string>();
  private readonly alive = new Set<WebSocket>();
  private monitor?: ReturnType<typeof setInterval>;
  private heartbeat?: ReturnType<typeof setInterval>;
  constructor(@Inject(configuer.KEY) private readonly config: IAppConfig) {}

  /** Attaches WebSocket to HTTP, polls session status every second, and checks liveness every 15 seconds. */
  attach(http: Server, source: ConnectionStatusSource): void {
    const path = `/${this.config.apiPrefix}/connections/events`.replace(
      /\/+/g,
      '/',
    );
    const legacyPath = path.replace(
      '/connections/events',
      '/test-panel/events',
    );
    this.server = new WebSocketServer({ noServer: true, maxPayload: 4096 });
    this.monitor = setInterval(() => {
      for (const [client, id] of this.subscriptions)
        this.sendStatus(client, id, source);
    }, 1000);
    this.heartbeat = setInterval(() => {
      for (const client of this.server?.clients ?? []) {
        if (!this.alive.delete(client)) {
          client.terminate();
          continue;
        }
        client.ping();
        if (this.subscriptions.has(client)) {
          client.send(
            JSON.stringify({
              event: 'transport.status',
              sessionId: this.subscriptions.get(client),
              at: new Date().toISOString(),
              data: { connected: true },
            }),
          );
        }
      }
    }, 15000);
    this.monitor.unref();
    this.heartbeat.unref();
    http.on('upgrade', (request, socket, head) => {
      const requestedPath = new URL(request.url ?? '/', 'http://localhost')
        .pathname;
      if (requestedPath !== path && requestedPath !== legacyPath) {
        socket.destroy();
        return;
      }
      // Browser origins must match the request host or appear in the allowed origins list.
      if (request.headers.origin) {
        try {
          const origin = request.headers.origin;
          if (
            new URL(origin).host !== request.headers.host &&
            !this.config.corsOrigins?.includes(origin)
          ) {
            socket.destroy();
            return;
          }
        } catch {
          socket.destroy();
          return;
        }
      }
      this.server!.handleUpgrade(request, socket, head, (client) => {
        this.alive.add(client);
        client.on('pong', () => this.alive.add(client));
        client.on('error', () => client.terminate());
        const timeout = setTimeout(
          () => client.close(1008, 'Authentication required'),
          5000,
        );
        client.once('close', () => {
          clearTimeout(timeout);
          this.subscriptions.delete(client);
          this.lastStatus.delete(client);
          this.alive.delete(client);
        });
        client.once('message', async (raw) => {
          try {
            const buffer = Buffer.isBuffer(raw)
              ? raw
              : Array.isArray(raw)
                ? Buffer.concat(raw)
                : Buffer.from(raw);
            const input = JSON.parse(buffer.toString('utf8')) as {
              token?: unknown;
              sessionId?: unknown;
            };
            const digest = (value: string) =>
              createHash('sha256').update(value).digest();
            if (
              typeof input.token !== 'string' ||
              typeof input.sessionId !== 'string' ||
              !input.sessionId ||
              !timingSafeEqual(
                digest(input.token),
                digest(this.config.whatsapp.adminApiKey),
              )
            ) {
              client.close(1008, 'Invalid credentials');
              return;
            }
            try {
              await source.exists(input.sessionId);
            } catch (error) {
              const missing =
                (error as { getStatus?: () => number }).getStatus?.() === 404;
              client.close(
                missing ? 1008 : 1013,
                missing
                  ? 'Session not found'
                  : 'Session validation unavailable',
              );
              return;
            }
            if (client.readyState !== WebSocket.OPEN) return;
            clearTimeout(timeout);
            this.subscriptions.set(client, input.sessionId);
            client.send(
              JSON.stringify({
                event: 'subscribed',
                sessionId: input.sessionId,
              }),
            );
            client.send(
              JSON.stringify({
                event: 'transport.status',
                sessionId: input.sessionId,
                at: new Date().toISOString(),
                data: { connected: true },
              }),
            );
            this.sendStatus(client, input.sessionId, source);
          } catch {
            client.close(1008, 'Invalid subscription');
          }
        });
      });
    });
  }

  /** Sends public session status, skips duplicates, and closes clients with over one megabyte queued. */
  private sendStatus(
    client: WebSocket,
    sessionId: string,
    source: ConnectionStatusSource,
  ): void {
    if (client.readyState !== WebSocket.OPEN) return;
    try {
      const snapshot = source.snapshot(sessionId);
      const data = {
        connected: snapshot.connected,
        status: snapshot.status,
        accountPhone: snapshot.accountPhone,
        generation: snapshot.generation,
        retryCount: snapshot.retryCount,
        nextRetryAt: snapshot.nextRetryAt,
        reason: snapshot.reason,
        lastDisconnectCode: snapshot.lastDisconnectCode,
        lastDisconnectedAt: snapshot.lastDisconnectedAt,
        requiresPairing: snapshot.requiresPairing,
      };
      const signature = JSON.stringify(data);
      if (this.lastStatus.get(client) === signature) return;
      if (client.bufferedAmount > 1024 * 1024) {
        client.terminate();
        return;
      }
      client.send(
        JSON.stringify({
          event: 'whatsapp.status',
          sessionId,
          at: new Date().toISOString(),
          data,
        }),
      );
      this.lastStatus.set(client, signature);
    } catch {
      client.close(1011, 'Status unavailable');
    }
  }

  /** Sends events only to subscribers of the target session and converts BigInt values to strings for JSON. */
  publish(sessionId: string, event: string, data: unknown): void {
    // Only pass public event data here; never pass the WhatsApp socket or authentication state.
    let payload: string;
    try {
      payload = JSON.stringify(
        { sessionId, event, at: new Date().toISOString(), data },
        (_key, value: unknown) =>
          typeof value === 'bigint' ? value.toString() : value,
      );
    } catch {
      return;
    }
    for (const [client, subscribed] of this.subscriptions) {
      if (subscribed !== sessionId || client.readyState !== WebSocket.OPEN)
        continue;
      if (client.bufferedAmount > 1024 * 1024) {
        client.terminate();
        continue;
      }
      client.send(payload);
    }
  }

  /** Stops polling and heartbeat timers and closes WebSocket connections during shutdown. */
  onModuleDestroy(): void {
    clearInterval(this.monitor);
    clearInterval(this.heartbeat);
    for (const client of this.server?.clients ?? []) client.terminate();
    this.server?.close();
  }
}
