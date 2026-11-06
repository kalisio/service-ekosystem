---
title: service-kross
description: Kalisio geometrical intersection service over multiple data providers
---

# service-kross

_Kalisio geometrical intersection service over multiple data providers_

## Overview

**kross** finds the features intersecting an input geometry across a set of **sources**, each one
served by a **provider**. It follows the same architecture as [geokoder](../service-geokoder/):
providers are declared in the configuration, each exposes its sources, and a request is dispatched
to every provider, then filtered by a source glob pattern.

| Provider | Sources | Backend |
|---|---|---|
| `DuckDB` | one per entry of `datasets` | [DuckDB](https://duckdb.org) with the `spatial` and `httpfs` extensions, reading GeoParquet (or any GDAL format) from object storage, HTTP or local files |

## Configuration

```js
providers: {
  DuckDB: {
    // DuckDB instance settings
    settings: { threads: '4', memory_limit: '1GB' },
    // Object storage access, mapped to a DuckDB S3 secret
    s3: {
      endpoint: process.env.S3_ENDPOINT, // host[:port], no scheme
      region: process.env.S3_REGION,
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
      urlStyle: 'path'
    },
    datasets: {
      communes: {
        url: `s3://${process.env.S3_BUCKET}/admin-express/communes.parquet`,
        format: 'parquet',      // default from the extension, 'gdal' uses ST_Read
        geometry: 'geometry',   // geometry column, default 'geometry'
        properties: ['insee_com', 'nom'] // optional, all columns but geometry by default
      }
    }
  }
}
```

Datasets are expected to be in the same CRS as the input geometry (WGS84 longitude/latitude).

## API

### `GET /api/capabilities/intersect`

Lists the available sources: `{ "sources": ["communes", ...] }`.

### `POST /api/intersect`

| Body field | Type | Description |
|---|---|---|
| `geometry` | GeoJSON geometry or feature | **required** — the geometry to intersect with |
| `sources` | string | glob pattern selecting the sources (`*`, `comm*`, `{communes,departements}`), default `*` |
| `limit` | integer | maximum number of features, default `paginate.default.intersect` (1000), capped by `paginate.max.intersect` (10000) |
| `clip` | boolean | return the intersection geometry instead of the source geometry, default `false` |

Responds with a GeoJSON `FeatureCollection`, each feature carrying `kross: { source }`.

```bash
curl -X POST http://localhost:8081/api/intersect \
  -H 'Content-Type: application/json' \
  -d '{ "sources": "communes", "clip": true, "geometry": { "type": "Polygon", "coordinates": [[[1.3,43.5],[1.5,43.5],[1.5,43.7],[1.3,43.7],[1.3,43.5]]] } }'
```
