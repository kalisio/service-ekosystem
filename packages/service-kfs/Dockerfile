ARG NODE_VERSION=20
ARG DEBIAN_VERSION=bookworm

FROM node:${NODE_VERSION}-${DEBIAN_VERSION}-slim AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.1.0 --activate

# Outils de compilation pour les modules natifs
RUN apt-get update && apt-get install -y --no-install-recommends \
  python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/service-kfs/package.json ./packages/service-kfs/

ENV NODE_ENV=production

RUN pnpm install \
  --frozen-lockfile \
  --filter @kalisio/service-kfs \
  --ignore-scripts \
  --prod

COPY packages/service-kfs/src ./packages/service-kfs/src
COPY packages/service-kfs/config ./packages/service-kfs/config

FROM node:${NODE_VERSION}-${DEBIAN_VERSION}-slim
LABEL maintainer="Kalisio <contact@kalisio.xyz>"

COPY --from=builder --chown=node:node /app /app
RUN ln -s /app/packages/service-kfs /kfs

USER node
WORKDIR /kfs
EXPOSE 8081

CMD ["node", "src/server.js"]
