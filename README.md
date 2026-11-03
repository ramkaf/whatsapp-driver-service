## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ pnpm install
```

## Application configuration

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
 
