---
title: service-kfs
description: Kalisio Features Services
---

# service-kfs

_Kalisio Features Services_

## Overview

**service-kfs** is a lightweight service that distributes geospatial data from applications built with the [Kalisio Development Kit (KDK)](https://kalisio.github.io/kdk/) — such as [Kano](https://kalisio.github.io/kano/) — through the [OGC API Features](https://ogcapi.ogc.org/features/) standard (a.k.a. WFS v3).

Each service-based layer from Kano generates one or two feature collection(s), depending on whether probes are used.

::: info
Under the hood, [feathers-distributed](https://github.com/kalisio/feathers-distributed) is used to access the exposed services. The service itself is stateless — it holds no database and simply re-exposes the remote feature services it discovers.
:::

## API

**service-kfs** implements the [OGC API Features](https://ogcapi.ogc.org/features/) standard (a.k.a. WFS v3). The full HTTP API is documented on the [API reference](./service-kfs-openapi) page.

Refer to the [OGC API Features](https://ogcapi.ogc.org/features/) standard for the complete specification. Current limitations:

- only **Part 1** of the standard is implemented
- only the [GeoJSON encoding](https://docs.opengeospatial.org/is/17-069r4/17-069r4.html#_requirements_class_geojson) is supported
- only a [bbox in WGS 84 CRS](https://docs.ogc.org/is/17-069r4/17-069r4.html#_parameter_bbox) is supported
- the following [CQL2](https://docs.ogc.org/is/21-065r2/21-065r2.html) filtering operators are supported:
  - logical: `and`, `or`, `not`
  - comparison: `eq`, `lt`, `gt`, `lte`, `gte`, `between`, `in`, `isNull`
  - advanced comparison: `like`, `ilike`
  - spatial: `s_intersects`, `s_within`
  - temporal: `t_before`, `t_after`, `t_during` (targeting an instant property, not an interval)

::: warning
CQL is fully supported only in the **JSON** encoding. In the **text** encoding, only the spatial (`S_INTERSECTS`, `S_WITHIN`), null (`IS NULL`, `IS NOT NULL`) and like (`LIKE`, `ILIKE`) filters are supported.
:::

## Configuration

The service is configured through environment variables:

| Variable | Description | Default |
| -------- | ----------- | ------- |
| `HOSTNAME` | Hostname | `localhost` |
| `PORT` | Port the API responds on | `8081` |
| `BASE_URL` | Base service URL used to fill links | `http://${HOSTNAME}:${PORT}${API_PREFIX}` |
| `API_PREFIX` | Prefix used on API routes | `/api` |
| `LIMIT` | Default pagination limit | `500` |
| `OFFSET` | Default pagination offset | `0` |
| `MAX` | Maximum pagination limit. When set, it overrides `paginate.max` for all services. | `null` |
| `TIME_UNIT` | Time unit used to compute temporal collection extents | `minute` |
| `DISTRIBUTION_TIMEOUT` | feathers-distributed request timeout, in milliseconds | `60000` |
| `DEBUG` | Namespaces to enable debug output. Use `kfs:*` for full output. | – |

::: info
The pagination options of the FeathersJS services (`paginate.default`, `paginate.max`) are retrieved and compared with the KFS default limit. If a service's default or maximum limit is lower, it is used instead — requesting more data than a service allows would not work.
:::

### local.cjs

By default, **service-kfs** only exposes the [features services](https://kalisio.github.io/kdk/api/map/services.html#features-service) provided by [Kano](https://kalisio.github.io/kano/). Add a `local.cjs` file to alter the default configuration.

The following example exposes services from another application:

```js
module.exports = {
  distribution: {
    // Application key in feathers-distributed
    remoteServices: (service) => (service.key === 'myapp')
  },
  // Declare any additional service that is not a features service but complies with the GeoJSON interface
  services: (serviceName, service) => {
    // This specific service complies with a GeoJSON interface using specific query parameters
    if (serviceName === 'myservice') return {
      query: { geoJson: true }
    }
  }
}
```

## Running

Start the service in watch mode for development:

```bash
pnpm dev
```

The API is then served at `http://localhost:8081/api`. The metadata endpoints (`/`, `/conformance`, `/definition`, `/healthcheck`) work out of the box; `/collections` becomes populated once an upstream application (e.g. Kano) distributes its feature services.

## Testing

Run the internal test suite:

```bash
pnpm test
```

::: info
The suite starts an in-process KDK app that stores fixtures, so it requires a MongoDB reachable at `mongodb://127.0.0.1:27017` (the test config auto-switches the host to `mongodb` when running inside a container).
:::

To run the [OGC API - Features Conformance Test Suite](https://github.com/opengeospatial/ets-ogcapi-features10), the simplest way is to use its [Docker container](https://github.com/opengeospatial/ets-ogcapi-features10/blob/master/src/site/asciidoc/how-to-run-the-tests.adoc#3-docker). Use your machine's local IP address rather than `localhost` (which will not work) and start KFS with `HOSTNAME=your_ip`.

You can also run it manually:

1. use the JAR file provided in `test/`, or download the "all-in-one" JAR (e.g. version `1.7`) from Maven Central,
2. update the target URL in `test/test-run-props.xml` if required,
3. run `java -jar ets-ogcapi-features10-1.7-aio.jar -o /path/to/output -h /path/to/test-run-props.xml`.

A useful tool to check OpenAPI specification conformance is [redocly-cli](https://github.com/Redocly/redocly-cli).

## Building

Build the Docker image:

```bash
docker build -t <your-image-name> .
```

The project is also configured to use **GitHub Actions** to build and push the image to [Kalisio's Docker Hub](https://hub.docker.com/u/kalisio/). The image is tagged using the `version` property of `package.json`. See the [Kalisio development toolkit](https://github.com/kalisio/development) for details.

## Deploying

The image is designed to be deployed with the [Kargo](https://kalisio.github.io/kargo/) project.

## License

Licensed under the [MIT License](https://opensource.org/licenses/MIT).
