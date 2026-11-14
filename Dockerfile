ARG NODE_IMAGE=node:24-bookworm-slim

FROM ${NODE_IMAGE} AS base
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*

FROM base AS dependencies
ARG PNPM_VERSION=12.16.1
ENV HUSKY=0
# The private registry configuration is available only during dependency installs.
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc,required=true \
    npm install --global pnpm@${PNPM_VERSION}
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc,required=true \
    pnpm install --frozen-lockfile

FROM dependencies AS tooling
COPY . .
# Client generation needs a valid configuration, but never connects during build.
# These dummy values keep deployment credentials out of image layers.
RUN DOTENV_CONFIG_PATH=/dev/null \
    DB_HOST=127.0.0.1 DB_PORT=3306 DB_USER=build DB_PASSWORD=build DB_NAME=build \
    pnpm run build

FROM dependencies AS production-dependencies
RUN pnpm prune --prod --ignore-scripts

FROM base AS production
ENV NODE_ENV=production \
    DOTENV_CONFIG_PATH=.env.prod \
    APP_PORT=3000
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=tooling --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./package.json
RUN mkdir -p /app/storage && chown node:node /app/storage
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
