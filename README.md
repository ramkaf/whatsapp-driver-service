## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
pnpm install --frozen-lockfile
pnpm run prepare
```

## Tests

Tests live in a `__test__` subdirectory of their owning module or library.
Application-wide integration tests live in `src/__test__`, and Swagger integration
tests live in `src/swagger/__test__`. Run `pnpm test` for unit tests and
`pnpm test:e2e` for HTTP integration tests. Test folders are excluded from builds.

## Local connection test panel

Run `pnpm start:dev` and open `http://localhost:3000/test-panel` (use your
configured port and prepend `API_PREFIX` if set). The application must finish
starting, including its database and Redis connections.

Enter `WA_ADMIN_API_KEY`, load existing sessions, or select QR/CODE and create
a session. CODE requires an international phone number; QR may omit it. Select
a session from the top menu. For QR, scan from WhatsApp's Linked devices screen.
For CODE, choose Link with phone number there and enter the displayed eight-character
code (Baileys does not use a six-character code). The panel shows expiry countdowns
and lets you explicitly renew pairing or change its method for unpaired accounts.
Use reconnect/disconnect to test recovery;
disconnect preserves stored authentication. Renew QR explicitly when pairing
expires. The key remains in page memory and is not embedded or saved by the page.

The monitor keeps one WebSocket per session and reconnects it after transport
failures. Selecting a session reuses that stream for details and message events;
it does not open another socket. QR images are polled once per account and shared
with the details view, together with pairing codes and their expiry countdowns.
It displays the latest 200 event objects, not the internal WASocket or auth keys.
Events are live only: selecting another session or refreshing does not replay
missed messages.

Read `GET /sessions/:id` for session metadata and the current `runtime` snapshot;
`runtime.connected` indicates live WhatsApp connectivity.

All disposable UI code lives in `src/modules/ui-test`: `UiTestModule`,
`UiTestController`, and `public/test-panel.html` (HTML, CSS, and browser JavaScript).
The page and QR-image routes remain under `/test-panel`. Nest copies the module's
assets into `dist/src/modules/ui-test/public` during builds, so deploy the complete
`dist/` directory. Source checkouts serve the module's HTML directly.

To remove the test UI, remove `UiTestModule` from `AppModule`, delete
`src/modules/ui-test`, and remove its asset entry from `nest-cli.json`. The QR
rendering dependencies `qrcode` and `@types/qrcode` are then removable too.
Connection status, WebSocket transport, and message events stay in
`ConnectionModule`; pairing/session APIs stay in their existing modules.

### Pairing REST API

All routes below require `Authorization: Bearer <WA_ADMIN_API_KEY>` and prepend
`API_PREFIX` when configured. Pairing responses have `Cache-Control: no-store`.

| Request                             | Body / result                                                                                                                                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /sessions`                    | `{"name":"Test QR","pairingMethod":"QR"}` or `{"name":"Test code","pairingMethod":"CODE","phone":"989121234567"}`. Returns a new `id`; CODE creation does not itself return a pairing code. |
| `POST /sessions/:id/qr`             | `{}` selects QR and starts or renews pairing. Returns the current QR metadata; `qr` may initially be null.                                                                                         |
| `GET /sessions/:id/qr`              | Reads `{sessionId,pairingMethod,status,qr,expiresAt}` without restarting. Refresh until QR is available; render locally.                                                                    |
| `POST /sessions/:id/pairing-code`   | `{"phone":"989121234567"}`, or `{}` to use the stored session phone. Returns `{sessionId,pairingMethod,status,code,expiresAt}`.                                                             |

Requesting QR or CODE also selects that pairing method for the unpaired session.
There is no separate method-selection request.

Phones are validated using libphonenumber and normalized to international digits.
Invalid/empty/null phone values, unsupported methods, and missing CODE phones are
rejected with 400. QR can omit a phone; a session's existing phone cannot be changed.
Already paired accounts return 409 for pairing and must use reconnect. Duplicate
phones return 409. Code requests share in-flight work, reuse unexpired codes, and
return 429 when rate-limited; unavailable pairing connections return 503. Expiry
is an application bound, not a guarantee that WhatsApp will accept the code.
Pairing codes/QR payloads are not included in the public WebSocket event stream.

## Connection WebSocket API

Connect to `ws://localhost:3000/connections/events` (use `wss` with HTTPS,
your configured port, and prepend `API_PREFIX` if set). Browser origins must
match the server or an explicit entry in `APP_CORS_ORIGINS`; `*` does not grant
WebSocket access.

Within five seconds of opening, send one subscription frame:

```json
{
  "token": "<WA_ADMIN_API_KEY>",
  "sessionId": "<id returned by POST /sessions>"
}
```

One WebSocket subscribes to one session. Reconnect with a different `sessionId`
to switch sessions, or open separate connections to monitor multiple accounts.
The server authenticates the admin key and validates the session's existence.
It routes all subsequent events using this ID, not a phone supplied by the client.

After `subscribed`, the server immediately sends both status objects:

```json
{"event":"transport.status","sessionId":"<id>","at":"<ISO timestamp>","data":{"connected":true}}
{"event":"whatsapp.status","sessionId":"<id>","at":"<ISO timestamp>","data":{"connected":true,"status":"CONNECTED","accountPhone":"989121234567","generation":1,"retryCount":0,"nextRetryAt":null}}
```

`whatsapp.status` comes from the in-memory session manager and live WASocket.
`accountPhone` comes only from `socket.user.id` and is null when disconnected,
unavailable, or the ID is a LID rather than a phone JID. The server checks runtime
changes every second and pushes a new object only when these status fields change;
the client does not need to poll HTTP. `status` uses the same session states as REST.
`connected` is true only when the manager is CONNECTED and its socket is open.

Both REST runtime and `whatsapp.status` include `reason`, `lastDisconnectCode`,
`lastDisconnectedAt`, and `requiresPairing`. These are runtime observations, not
a persisted disconnect history; they reset with the process. `reason` clears on
successful connection and remains available during recovery. Last disconnect
metadata remains available after reconnect until the next disconnect.

| State / reason                             | Meaning                                                                              |
| ------------------------------------------ | ------------------------------------------------------------------------------------ |
| `CONNECTED`                                | Manager connected and live socket open.                                              |
| `RECONNECTING`                             | A bounded retry is scheduled; see `retryCount` and `nextRetryAt`.                    |
| `SOCKET_CLOSED`                            | The live socket closed or disappeared, even if its close event is still queued.      |
| `TIMEOUT_OR_CONNECTION_LOST`               | Baileys code 408; it cannot distinguish timeout from connection loss by code alone.  |
| `LOGGED_OUT`                               | Account/device logged out. New pairing required.                                     |
| `CONNECTION_REPLACED`                      | Another connection replaced this one. Automatic retry stops.                         |
| `INVALID_SESSION` / `MULTIDEVICE_MISMATCH` | Authentication state is unusable. Explicit pairing required.                         |
| `FORBIDDEN`                                | WhatsApp rejected access; the code alone does not prove an account ban.              |
| `QR_EXPIRED` / `PAIRING_CODE_EXPIRED`      | Pairing opportunity expired; this is not a timer expiring an already paired account. |
| `MANUAL_DISCONNECT`                        | Stopped by an API request. Stored authentication is retained.                        |
| `RETRY_LIMIT_REACHED`                      | Automatic retries exhausted.                                                         |

`EXPIRED` for a pairing code is computed from its expiry time without clearing
credentials or logging the account out. Unknown disconnects use `UNKNOWN_CLOSE`;
the API does not guess a more specific cause. The UI displays translated status
and reason labels as well as the raw JSON fields.

`transport.status` is sent initially and every 15 seconds as an application
heartbeat. The server also uses native WebSocket ping/pong and drops unresponsive
clients. Browsers answer native pings automatically. Clients should mark transport
disconnected and WhatsApp state unknown on `close`/`error` or after 40 seconds
without a message, then reconnect and resubscribe. A broken transport cannot
deliver a final `connected:false` event; it also does not imply WhatsApp is offline.

The same stream carries `messages.upsert`, `messages.update`, and the raw limited
`connection.update`. Use `whatsapp.status` for the managed connection indicator.
Invalid credentials, missing sessions, and invalid subscriptions close with 1008;
session validation failures close with 1013; status read failures close with 1011.
Messages are live only, while reconnecting always receives a fresh status snapshot.

## Prisma / MySQL

Prisma lives in `libs/prisma`: `schema.prisma`, migrations, and the NestJS
`PrismaModule` / `PrismaService` (imported as `@libs/prisma`). Prisma 7 uses
the MariaDB driver adapter for MySQL. Both the CLI and Nest service read
`DATABASE_URL` through the shared configuration resolver in `libs/common`;
Nest receives it through the existing `configuer` injection token.

Set `DATABASE_URL` in `.env`, using `.env.example` as a template:

```dotenv
DATABASE_URL=mysql://wa_user:change_me@localhost:3306/whatsapp
```

Then generate the client and apply the checked-in migration:

```bash
pnpm run prisma:generate
pnpm run prisma:deploy
```

For future schema changes use `pnpm run prisma:migrate --name <change_name>`.
Build regenerates the client automatically. The generated client is ignored by Git.
The app requires a reachable database at startup and disconnects during shutdown.
`prisma:deploy` is explicit; starting the app does not modify the database schema.

The schema defines `wa_sessions`, `wa_auth_creds`, `wa_auth_keys`, and
`wa_session_events`. IDs default to CUID strings within VARCHAR(30). Database
columns use snake_case; Prisma fields use camelCase. Phone is nullable before
pairing and unique when present; application code must normalize/validate E.164.
Connection timestamps, error details, instance ownership and event metadata are
nullable until available. Credentials are unique per session, and Signal keys
are unique by `(sessionId, type, keyId)`. Deleting a session cascades to its
credentials, keys and events. `updatedAt` is maintained by Prisma writes.
Signal key type/ID comparisons are case-sensitive in the initial MySQL migration.
Baileys buffer serialization and auth-state persistence are separate from these models.
Pairing codes, locks, timers and sockets are not persisted in these tables.

Inject `PrismaService` into providers of a module importing `PrismaModule`.
For example: `prisma.waSession.findMany()` or `prisma.waAuthKey.upsert(...)`.

## Environment configuration

Redis is provided by `libs/common/src/redis`. Import `RedisModule` in a module
and inject `RedisService`; use `redisService.client` for Redis commands.
`AppModule` already imports it. Start the Redis container with:

```bash
docker compose up -d redis
```

The container uses `docker.afralab.ir/library/redis:7`, password authentication,
AOF persistence in `redis_data`, and a PING healthcheck. The app running on the
host uses the following `.env` settings (a random password is set in local `.env`):

```dotenv
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=replace_with_a_strong_password
REDIS_DB=0
REDIS_CONNECT_TIMEOUT_MS=5000
REDIS_CONNECTION_ATTEMPTS=5
REDIS_RETRY_DELAY_MS=1000
REDIS_MAX_RETRY_DELAY_MS=30000
```

Settings are validated and exposed through `IAppConfig.redis` / `IRedisConfig`.
Startup waits for a ready Redis connection, makes at most five attempts by
default, and fails if they are exhausted. Delays use full jitter between zero
and `min(maxRetryDelayMs, retryDelayMs * 2 ** (failedAttempt - 1))`.
Connection loss during runtime also triggers bounded reconnection with jitter;
after exhaustion commands fail until the service is restarted or explicitly
reconnected. Commands are not queued while disconnected. Shutdown sends QUIT
when ready and closes the client. Connection errors, readiness, reconnection,
retry exhaustion, and shutdown are logged without the password.

Copy `.env.example` to `.env` and adjust the values for your environment.
Configuration is registered under `app` in `libs/common/src/config/index.ts`.
The factory validates environment variables during startup and fails with the
invalid variable names if validation fails.

- `NODE_ENV`: `development` (default), `production`, or `test`.
- `APP_NAME`: defaults to `boilerplate`.
- `APP_PORT` / `PORT`: integer from 0 to 65535; `APP_PORT` takes precedence,
  followed by `PORT`, then 3000. Port 0 requests an available port.
- `FRONTEND_DOMAIN`: optional HTTP(S) URL; used as the CORS fallback.
- `BACKEND_DOMAIN`: HTTP(S) URL; defaults to `http://localhost`.
- `APP_CORS_ORIGINS`: comma-separated origins; defaults to `FRONTEND_DOMAIN`
  or `*`. An explicit `*` allows all origins.
- `API_PREFIX`: defaults to `api`; an empty value disables the prefix.

The default application route is `GET /api`. `workingDirectory` is resolved
from `process.cwd()` rather than an environment variable. Domain values are
metadata; the listening port is controlled separately by `APP_PORT` / `PORT`.

Inject the configuration using `@Inject(appConfig.KEY)` and the `IAppConfig`
type, or retrieve it with `app.get<IAppConfig>(appConfig.KEY)`.

## Compile and run the project

```bash
# development
$ pnpm run start

# watch mode
$ pnpm run start:dev

# production mode
$ pnpm run start:prod
```

## Run tests

```bash
# unit tests
$ pnpm run test

# e2e tests
$ pnpm run test:e2e

# test coverage
$ pnpm run test:cov
```

## Deployment

### Documation

```bash
$ pnpm  run up
$ pnpm  run down
```

Then follow the [setup guide](https://docs.nestjs.com/observability/overview) - it takes a single import and an app key.

The free plan needs no payment details and covers 300,000 events a month. You can also browse the [live demo](https://www.observe-demo.nestjs.com/dashboard) first - the whole dashboard over a busy service's data, with nothing to install.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Auto-instrument your application with [NestJS Observe](https://observe.nestjs.com). Distributed tracing, metrics, and logging made easy. Error tracking and performance monitoring for your NestJS applications.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## WhatsApp session manager

See [session management and operations](docs/backend/whatsapp-sessions.md) for the
module structure, migration review, environment variables, authenticated endpoints,
CODE/QR pairing examples, restart/reconnection behavior, and operational limits.
