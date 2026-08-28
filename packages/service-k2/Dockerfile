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
COPY packages/service-k2/package.json ./packages/service-k2/

ENV NODE_ENV=production

RUN pnpm install \
  --frozen-lockfile \
  --filter @kalisio/service-k2 \
  --ignore-scripts \
  --prod

RUN pnpm --filter @kalisio/service-k2 rebuild sqlite3

COPY packages/service-k2/src ./packages/service-k2/src

FROM node:${NODE_VERSION}-${DEBIAN_VERSION}-slim
LABEL maintainer="Kalisio <contact@kalisio.xyz>"

# GDAL runtime (gdalwarp) required by the /elevation endpoint
RUN apt-get update && apt-get install -y --no-install-recommends \
  gdal-bin \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder --chown=node:node /app /app
RUN ln -s /app/packages/service-k2 /k2

USER node
WORKDIR /k2
EXPOSE 8080

CMD ["node", "src/main.js"]
