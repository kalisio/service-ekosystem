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
COPY packages/service-geokoder ./packages/service-geokoder

ENV NODE_ENV=production

RUN pnpm install \
  --frozen-lockfile \
  --filter @kalisio/service-geokoder \
  --ignore-scripts \
  --prod

RUN pnpm --filter @kalisio/service-geokoder rebuild sqlite3
RUN pnpm --filter @kalisio/service-geokoder rebuild sqlite3 @mapbox/vtquery

FROM node:${NODE_VERSION}-${DEBIAN_VERSION}-slim
LABEL maintainer="Kalisio <contact@kalisio.xyz>"

COPY --from=builder --chown=node:node /app /app

USER node
WORKDIR /app/packages/service-geokoder
EXPOSE 8080

CMD ["node", "src/main.js"]
