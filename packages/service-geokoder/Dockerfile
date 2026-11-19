ARG NODE_VERSION=20
ARG DEBIAN_VERSION=bookworm

FROM node:${NODE_VERSION}-${DEBIAN_VERSION}-slim AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.34.5 --activate

# Outils de compilation pour les modules natifs
RUN apt-get update && apt-get install -y --no-install-recommends \
  python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/core-service ./packages/core-service
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

# DuckDB provider needs ca certificates to access S3 datasets
RUN DEBIAN_FRONTEND=noninteractive && \
  apt-get update && \
  apt-get --no-install-recommends --yes install \
    ca-certificates && \
  apt-get clean && \
  rm -rf /var/lib/apt/lists/*

COPY --from=builder --chown=node:node /app /app
RUN ln -s /app/packages/service-geokoder /geokoder

USER node
WORKDIR /geokoder
EXPOSE 8080

CMD ["node", "--conditions=development", "src/main.js"]
