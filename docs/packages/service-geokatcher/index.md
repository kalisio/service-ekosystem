---
title: service-geokatcher
description: geoKatcher is a service that allows to monitor geofences between two layers of geospatial data.
---

# service-geokatcher

_geoKatcher is a service that allows to monitor geofences between two layers of geospatial data._

## Overview

**geoKatcher** monitors geofences between two layers of geospatial data. For now, only one source is supported:

- Kalisio Maps ([_Kano_](https://github.com/kalisio/kano))

Using the [feathers](https://github.com/feathersjs/feathers) framework and the
[feathers-distributed](https://github.com/kalisio/feathers-distributed) extension, geoKatcher discovers Kano
services and queries them to retrieve layers and features. It also publishes its own `monitor` service, so other
services can interact with it and receive events.

## Installation

Install with your preferred package manager:

::: code-group

```bash [pnpm]
pnpm add @kalisio/service-geokatcher
```

```bash [npm]
npm install @kalisio/service-geokatcher
```

```bash [yarn]
yarn add @kalisio/service-geokatcher
```

:::

## API

**service-geokatcher** exposes two HTTP surfaces:

- a **`/healthcheck`** endpoint returning the service name and its version;
- a **`/monitor`** service providing full CRUD over geofence monitors (`POST /monitor`, `GET /monitor`,
  `GET /monitor/:id`, `PUT /monitor/:id`, `PATCH /monitor/:id`, `DELETE /monitor/:id`).

A **monitor** compares two layers — a `target` and a `zone` — with an `evaluation` (`geoWithin`, `geoIntersects`
or `near`) and, optionally, runs an `action` (Slack, crisis or custom webhook) when its alert status changes.
Even without an action, the monitor emits an event on its feathers service on every status change. A special
`dryRun` monitor lets you test a configuration without persisting it, running any action or emitting events.

The full request/response schema — the monitor structure, the evaluation and action options, the
service-generated fields and the error codes — is documented on the [API reference](./service-geokatcher-openapi)
page.

## Configuration

The service is configured through environment variables:

| Variable       | Description                                                                 | Default                                 |
|----------------|-----------------------------------------------------------------------------|-----------------------------------------|
| `PORT`         | The port to expose the service on                                           | `8080`                                  |
| `HOSTNAME`     | The hostname to expose the service on                                       | `localhost`                             |
| `DB_URL`       | The URL of the MongoDB database                                             | `mongodb://localhost:27017/geokatcher`  |
| `BASE_URL`     | The URL used when exposing the service                                      | `http://localhost:8080`                 |
| `API_PREFIX`   | The path prefix used to reach the consumed Kano services                    | `/api`                                  |
| `COTE_ENV`     | The [cote](https://github.com/kalisio/feathers-distributed) environment used to discover Kano — must match the Kano instance | -              |
| `NODE_ENV`     | Set to `development` to enable verbose logging                              | -                                       |
| `VERSION`      | Overrides the version reported by `/healthcheck`                            | package version                         |
| `BUILD_NUMBER` | When set, added as `buildNumber` in the `/healthcheck` response             | -                                       |

## Running

Start the service in watch mode for development:

```bash
pnpm dev
```

The service listens on the port set by `PORT` (default `8080`), exposing a `/healthcheck` endpoint. Through
`feathers-distributed`, it waits for a Kano instance's services to be advertised before it starts querying
layers, so a Kano instance reachable on the same [cote](https://github.com/kalisio/feathers-distributed) network
(same `COTE_ENV`) must be running for it to become fully operational.

## Testing

Run the test suite:

```bash
pnpm test
```

The [vitest](https://vitest.dev/) suite **boots the real service** against a real MongoDB instance and a real Kano
instance (started from the workspace scripts, which also set the `COTE_ENV` the two services need to discover each
other over cote) — no mocks are used for the database or for Kano.

## Building

Build the Docker image (from the package directory):

```bash
pnpm build
```

This produces `service-geokatcher:latest` using the monorepo root as the build context. Override the tag with the
`TAG` environment variable.

## Deploying

The image is designed to be deployed with the [Kargo](https://kalisio.github.io/kargo/) project.

## License

Licensed under the [MIT License](https://opensource.org/licenses/MIT).
