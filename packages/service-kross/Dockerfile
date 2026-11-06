ARG NODE_VERSION=20
ARG DEBIAN_VERSION=bookworm

FROM node:${NODE_VERSION}-${DEBIAN_VERSION}-slim AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.34.5 --activate

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/service-kross ./packages/service-kross

ENV NODE_ENV=production

RUN pnpm install \
  --frozen-lockfile \
  --filter @kalisio/service-kross \
  --ignore-scripts \
  --prod

FROM node:${NODE_VERSION}-${DEBIAN_VERSION}-slim
LABEL maintainer="KALISIO <>"

COPY --from=builder --chown=node:node /app /app
RUN ln -s /app/packages/service-kross /kross

USER node
WORKDIR /kross
EXPOSE 8080

CMD ["node", "src/main.js"]
