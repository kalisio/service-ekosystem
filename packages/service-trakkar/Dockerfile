ARG NODE_VERSION=20
ARG DEBIAN_VERSION=bookworm

FROM node:${NODE_VERSION}-${DEBIAN_VERSION}-slim AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.34.5 --activate


COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/service-trakkar/package.json ./packages/service-trakkar/

ENV NODE_ENV=production

RUN pnpm install \
  --frozen-lockfile \
  --filter @kalisio/service-trakkar \
  --ignore-scripts \
  --prod

COPY packages/service-trakkar/src ./packages/service-trakkar/src
COPY packages/service-trakkar/config ./packages/service-trakkar/config

FROM node:${NODE_VERSION}-${DEBIAN_VERSION}-slim
LABEL maintainer="Kalisio <contact@kalisio.xyz>"

COPY --from=builder --chown=node:node /app /app
RUN ln -s /app/packages/service-trakkar /trakkar

USER node
WORKDIR /trakkar
EXPOSE 3000

CMD ["node", "src/index.js"]
