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
tests live in `src/swagger/__test__`. Run `pnpm test` for unit, component and media
integration tests, and `pnpm test:e2e` for HTTP integration tests. Test folders are
excluded from builds.

The suites mock WhatsApp downloads, database operations and external storage;
they do not require a paired account or live infrastructure. WebSocket transport
tests open a local loopback port. Event templates are checked for registration
and routing; persistence and media processing are tested through the inbox worker.

Run `pnpm run test:cov` to generate `coverage/index.html` and
`coverage/coverage-summary.json`. This report covers the unit/component suite;
generated Prisma code, test fixtures and declaration files are excluded.

## Local connection test panel

Run `pnpm start:dev` and open `http://localhost:3000/test-panel` (use your
configured port and prepend `API_PREFIX` if set). The application must finish
starting, including its database and Redis connections.

Enter `WA_ADMIN_API_KEY`, load existing sessions, or select QR/CODE and create
a session. Both QR and CODE require an international phone number. Pairing,
reconnect and delete controls are on each monitor card. Delete sets `isEnabled=false`,
stops the socket and retries, and preserves authentication. The disabled card
remains visible; use reconnect to resume explicitly. For QR, scan from WhatsApp's Linked devices screen.
For CODE, choose Link with phone number there and enter the displayed eight-character
code (Baileys does not use a six-character code). The panel shows expiry countdowns
and lets you explicitly renew pairing or change its method for unpaired accounts.
Use reconnect/disconnect to test recovery;
disconnect preserves stored authentication. Renew QR explicitly when pairing
expires. The key remains in page memory and is not embedded or saved by the page.

The monitor keeps one WebSocket per enabled session and reconnects it after transport
failures. Select an account directly in the Live events tab, or use its monitor
card's Events button. Selection reuses the existing stream without opening another
socket. Switching accounts clears displayed events. QR images, pairing codes and
their expiry countdowns are shown on the corresponding monitor card.
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
| `POST /sessions`                    | `{"name":"Test QR","pairingMethod":"QR","phone":"989121234567"}` or `{"name":"Test code","pairingMethod":"CODE","phone":"989131234567"}`. Returns a new `id`; CODE creation does not itself return a pairing code. |
| `POST /sessions/:id/qr`             | `{}` selects QR and starts or renews pairing. Returns the current QR metadata; `qr` may initially be null.                                                                                         |
| `GET /sessions/:id/qr`              | Reads `{sessionId,pairingMethod,status,qr,expiresAt}` without restarting. Refresh until QR is available; render locally.                                                                    |
| `POST /sessions/:id/pairing-code`   | `{"phone":"989121234567"}`, or `{}` to use the stored session phone. Returns `{sessionId,pairingMethod,status,code,expiresAt}`.                                                             |
| `DELETE /sessions/:id`             | Returns 204 after setting `isEnabled=false`, cancelling retries and stopping the socket. Session data and authentication remain stored. |

Requesting QR or CODE also selects that pairing method for the unpaired session.
There is no separate method-selection request.

Phones are validated using libphonenumber and normalized to international digits.
Invalid/empty/null or missing phone values and unsupported methods are rejected
with 400 for both QR and CODE. A session's existing phone cannot be changed.
Already paired accounts return 409 for pairing and must use reconnect. Creating
the same normalized phone retires its prior version (`isEnabled=false`,
`supersededAt` set) and creates a new ID with independent authentication. The old
socket and retries stop first; old credentials and events remain in the database.
Retired IDs are excluded from APIs, recovery and the monitor. A current session
that was manually disconnected remains visible and can reconnect. Replacement
uses one active slot even when the session limit is reached.
Code requests share in-flight work, reuse unexpired codes, and
return 429 when rate-limited; unavailable pairing connections return 503. Expiry
is an application bound, not a guarantee that WhatsApp will accept the code.
Pairing codes/QR payloads are not included in the public WebSocket event stream.

## Message receiving

`MessagesModule` groups `MessagesReceiveModule` and `MessagesSendModule`.
Receiving starts with the application and does not require the test panel or a
browser subscription. `ConnectionMessageSource` bridges current Baileys sockets
to `MessagesReceiveService`, which dispatches each event to a handler in
`src/modules/messages/receive/events`:

- `messages.upsert`, `messages.update`, `messages.delete`
- `messages.reaction`, `messages.media-update`, `message-receipt.update`
- `messaging-history.set`, `messaging-history.status`

Each message or update is written through `MessageEventOutput` to
`storage/<session-phone>.jsonl`, retaining `sessionId`, `event`, `at` and `data`.
BigInt metadata is serialized as decimal strings. Upsert batches are processed
item by item, including `notify`, offline `append` and own-message echoes.
History messages retain a distinct event name.

Images, videos, audio, voice notes, documents and stickers in upserts, history
and message edits are downloaded by `MediaService` and streamed to
`MinioStorageService` before the message is written. Wrapped messages, including
view-once and ephemeral attachments, use the same path. The output record gains
`media` with `bucket`, `objectKey`, `etag`, media type, MIME type and message/sender
identifiers. After a successful upload, `media.url` contains a presigned download
URL valid for seven days; `media.urlExpiresAt` records its ISO expiry timestamp.
The URL uses the configured MinIO API endpoint. The stored object and its
`bucket`/`objectKey` remain available after the link expires. Objects use
`conversations/<chat-id>/<UTC-timestamp>_<uuid>_<message-id>.<ext>`.
The conversation is the only folder under `conversations`; session IDs, sender
IDs and message IDs do not create additional folders. Filenames start with the
current UTC date/time and include a UUID for unique names. Before uploading,
`MinioStorageService.exists()` scans that conversation's folder for the full
message ID in a filename and compares the object's byte size. A match reuses the
existing object and returns a fresh download URL. Files with different sizes are
stored separately. Checks and uploads for the same conversation/message are
serialized within the application so simultaneous deliveries reuse one upload.

Downloads stream to a temporary file to measure their actual size without loading
the attachment into memory. The temporary file is removed after the check/upload,
including on failure; duplicate files are downloaded but are not uploaded again.

Configure `MINIO_ENDPOINT` (hostname without a URL scheme), `MINIO_PORT` (the
published S3 API port), `MINIO_USE_SSL` (`true`/`false`), `MINIO_ACCESS_KEY`,
`MINIO_SECRET_KEY` and `MINIO_BUCKET`. The application verifies or creates the
bucket during startup. MinIO credentials and connectivity are required when
starting the receiving module.

For the local Compose service, `.env` uses `MINIO_ENDPOINT=127.0.0.1` and
`MINIO_PORT=9003`: host port 9003 forwards to the container's S3 API port 9000.
The browser console is at `http://127.0.0.1:9002`; do not use that console port
for the SDK. After changing these settings, run
`docker compose up -d --no-deps minio` and restart the application so it reloads
`.env`.

A failed download/upload retains the original message with
`mediaError: "MEDIA_STORAGE_FAILED"`; later messages and other sessions continue.
Receipt/reaction/deletion and `messages.media-update` notifications do not contain
full attachments and are recorded without downloading. Receiving awaits pending
output on shutdown. Processing has no durable replay or deduplication guarantee.
Socket cleanup removes listeners and rejects events and media reupload requests
from obsolete generations.

Sending currently has only the `MessagesSendService` abstract contract, command
and result types, and its module. No sending provider or endpoint is registered.
The command identifies the chosen sender by `sessionId`.

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
| `RECONNECTING`                             | A retry with capped delay is scheduled; see `retryCount` and `nextRetryAt`.                    |
| `SOCKET_CLOSED`                            | The live socket closed or disappeared, even if its close event is still queued.      |
| `TIMEOUT_OR_CONNECTION_LOST`               | Baileys code 408; it cannot distinguish timeout from connection loss by code alone.  |
| `LOGGED_OUT`                               | Account/device logged out. New pairing required.                                     |
| `CONNECTION_REPLACED`                      | Another connection replaced this one. Automatic retry stops.                         |
| `INVALID_SESSION` / `MULTIDEVICE_MISMATCH` | Authentication state is unusable. Explicit pairing required.                         |
| `FORBIDDEN`                                | WhatsApp rejected access; the code alone does not prove an account ban.              |
| `QR_EXPIRED` / `PAIRING_CODE_EXPIRED`      | Pairing opportunity expired; this is not a timer expiring an already paired account. |
| `MANUAL_DISCONNECT`                        | Stopped by an API request. Stored authentication is retained.                        |

`EXPIRED` for a pairing code is computed from its expiry time without clearing
credentials or logging the account out. Unknown disconnects use `UNKNOWN_CLOSE`;
the API does not guess a more specific cause. The UI displays translated status
and reason labels as well as the raw JSON fields.

Temporary disconnects keep retrying with exponential backoff and jitter, capped
at a 60-second delay, without an attempt limit. Terminal authentication failures,
manual disconnects and unrecoverable errors still stop recovery.

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
Build and the `start`, `start:dev`, and `start:debug` scripts regenerate the client
automatically. After changing the schema or applying migrations while a watcher
is running, restart `pnpm start:dev` to reload the generated client. If a query
reports a removed column such as `instance_id`, check `pnpm exec prisma migrate status`,
then regenerate the client and rebuild/restart the application. Do not edit files
inside `src/generated` by hand.
The app requires a reachable database at startup and disconnects during shutdown.
`prisma:deploy` is explicit; starting the app does not modify the database schema.

The schema defines `wa_sessions`, `wa_auth_creds`, `wa_auth_keys`, and
`wa_session_events`. IDs default to CUID strings within VARCHAR(30). Database
columns generally use snake_case; Prisma fields use camelCase. Phone is required
and indexed with `superseded_at`; serializable replacement transactions preserve
one current version per normalized phone. Application code validates E.164.
`isEnabled` controls
automatic recovery and uses the same column name in MySQL.
Connection timestamps, error details and event metadata are
nullable until available. Credentials are unique per session, and Signal keys
are unique by `(sessionId, type, keyId)`. Physical database deletion cascades to its
credentials, keys and events; the session DELETE API performs soft deletion and
retains these records. `updatedAt` is maintained by Prisma writes.
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
