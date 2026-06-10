# Build from the monorepo root:
#   docker build -f packages/kapture/Dockerfile -t kalisio/kapture .
#
# Puppeteer notes (see kalisio/kapture):
#   - https://github.com/puppeteer/puppeteer/blob/main/docs/troubleshooting.md#running-puppeteer-in-docker
#   - WebGL support: https://github.com/flolu/docker-puppeteer-webgl/blob/master/Dockerfile

ARG NODE_VERSION=20
ARG DEBIAN_VERSION=bookworm

FROM node:${NODE_VERSION}-${DEBIAN_VERSION}-slim AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.1.0 --activate

# The runtime image provides Chrome via apt, so skip Puppeteer's Chromium download
ENV PUPPETEER_SKIP_DOWNLOAD=true

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/kapture/package.json ./packages/kapture/

RUN pnpm install --frozen-lockfile --ignore-scripts --filter @kalisio/kapture --prod

COPY packages/kapture/src ./packages/kapture/src

FROM node:${NODE_VERSION}-${DEBIAN_VERSION}-slim
LABEL maintainer="Kalisio <contact@kalisio.xyz>"

# Install Google Chrome — provides the browser and all its system libraries —
# plus fonts and a headless X server for Puppeteer
RUN export DEBIAN_FRONTEND=noninteractive \
  && apt-get update \
  && apt-get install -y wget gnupg \
  && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
  && sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
  && apt-get update \
  && apt-get install -y \
    google-chrome-stable \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    libxss1 \
    xorg \
    xserver-xorg \
    xvfb \
    libx11-dev \
    libxext-dev \
    --no-install-recommends \
  && rm -rf /var/lib/apt/lists/*

# Use the system Chrome installed above instead of a Puppeteer-managed browser
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

COPY --from=builder --chown=node:node /app /app

USER node
WORKDIR /app/packages/kapture
EXPOSE 3000

CMD ["node", "src/bin.js"]
