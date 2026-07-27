---
title: service-trakkar
description: A simple gateway between a traccar instance and Kalisio Maps instance.
---

# service-trakkar

_A simple gateway between a traccar instance and Kalisio Maps instance._

## Overview

**service-trakkar** bridges a [Traccar](https://www.traccar.org/) GPS tracking
server and a [Kalisio Maps](https://kalisio.com/) instance. It:

- authenticates against the Traccar instance and opens a **WebSocket** to receive
  device positions in real time;
- periodically re-fetches the last known positions through the Traccar REST API,
  as a fallback for the times the WebSocket does not emit events;
- converts each device/position into a GeoJSON `Feature` and pushes it to the
  Maps `tracking` service;
- maps devices to map **subLayers** through configurable [filters](#devices-to-layers).

## Installation

Install with your preferred package manager:

::: code-group

```bash [pnpm]
pnpm add @kalisio/service-trakkar
```

```bash [npm]
npm install @kalisio/service-trakkar
```

```bash [yarn]
yarn add @kalisio/service-trakkar
```

:::

## Configuration

The service is configured through environment variables:

| Variable           | Description                                                                 |
|--------------------|-----------------------------------------------------------------------------|
| `TRACCAR_EMAIL`    | The email used to connect to the Traccar instance.                          |
| `TRACCAR_PASSWORD` | The password used to connect to the Traccar instance.                       |
| `TRACCAR_URL`      | The full base URL of the Traccar instance, **including scheme and port** (e.g. `http://traccar.example.com:8082`). The WebSocket URL is derived from it. |
| `PORT`             | The port the service itself listens on. Defaults to `8080`.                 |

For real deployments, set these via environment variables. `config/default.cjs` ships with local/dev placeholder values (`admin@example.com`, `http://localhost:8082`, …) so the service can start without them — override at least `TRACCAR_URL` and the credentials to connect to an actual Traccar instance.

Alternatively, values can be set through a local configuration file
`config/local.cjs`, which overrides the defaults:

```javascript
module.exports = {
  email: 'traccar@example.com',
  password: 'password',
  traccar_url: 'http://traccar.example.com:8082',
  port: 8080,
  // Polling interval (ms) used to throttle updates sent to Maps
  update_interval: 200
}
```

## Devices to Layers

You can use **filters** to map Traccar devices to the subLayers that Maps can
filter on in the UI. Filters are defined in the configuration:

```javascript
// Each entry is matched against the JSON object coming from Traccar
// (not a GeoJSON feature), e.g. { query: { deviceId: 3 }, subLayer: 'KALISIO_TEAM' }
// `query` selects the devices ({} matches all); the first matching filter wins.
filters: [
  { query: {}, subLayer: 'KALISIO_TEAM' }
]
```

## Running

Start the service in watch mode for development:

```bash
pnpm dev
```

The service listens on the port set by `PORT` (default `8080`), exposing a
`/healthcheck` endpoint. It waits for a Maps instance (e.g. Kano) to distribute
its `features` and `catalog` services before connecting to Traccar.

## Testing

Run the test suite:

```bash
pnpm test
```

The [vitest](https://vitest.dev/) suite **boots the real service** and
exercises it against an in-memory stand-in Traccar (a real HTTP + WebSocket server)
and in-memory Maps services — so it needs **no external Traccar or database**:

- `test/helper.test.js` — the data helpers: Traccar login, feature generation, layer updates;
- `test/traccar.test.js` — the full WebSocket pipeline: a position streamed over the
  socket lands as a feature in the Maps tracking service.

For manual checks against a live Traccar instance, two GPS simulators are
provided. They replay trajectories and push positions to Traccar's OsmAnd
endpoint:

```bash
node test/demo.js   # replays GeoJSON trajectories for several devices
node test/gen.js    # loops a single device around a fixed route
```

## Building

Build the Docker image (from the package directory):

```bash
pnpm build
```

This produces `service-trakkar:latest` using the monorepo root as the build
context (`docker build -f ./Dockerfile ../..`). Override the tag with the `TAG`
environment variable.

## Deploying

The image is designed to be deployed with the [Kargo](https://kalisio.github.io/kargo/) project.

## License

Licensed under the [MIT License](https://opensource.org/licenses/MIT).
