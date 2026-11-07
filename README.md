## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
pnpm install --frozen-lockfile
pnpm run prepare
```

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
