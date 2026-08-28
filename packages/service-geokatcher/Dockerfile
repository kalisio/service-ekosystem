ARG NODE_VERSION=20
ARG DEBIAN_VERSION=bookworm

FROM node:${NODE_VERSION}-${DEBIAN_VERSION}-slim AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.34.5 --activate

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/service-geokatcher/package.json ./packages/service-geokatcher/

ENV NODE_ENV=production

RUN pnpm install \
  --frozen-lockfile \
  --filter @kalisio/service-geokatcher \
  --ignore-scripts \
  --prod

COPY packages/service-geokatcher/src ./packages/service-geokatcher/src
COPY packages/service-geokatcher/config ./packages/service-geokatcher/config

FROM node:${NODE_VERSION}-${DEBIAN_VERSION}-slim
LABEL maintainer="Kalisio <contact@kalisio.xyz>"

COPY --from=builder --chown=node:node /app /app

USER node
WORKDIR /app/packages/service-geokatcher
EXPOSE 8080

CMD ["node", "src/bin.js"]
