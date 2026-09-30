# service-geokoder

## General Architecture

A **Feathers.js** (express) application exposing a multi-provider geocoding API (forward/reverse).

### Key Files

- `src/server.js` — `createServer(configOverride = {})` factory that instantiates the app
- `src/providers.js` — `Providers` singleton managing the provider lifecycle
- `src/routes.js` — HTTP routes: `/healthcheck`, `/capabilities/:operation`, `/forward`, `/reverse`
- `src/providers/` — one file per provider: `kano.js`, `opendatafrance.js`, `openstreetmap.js`, `mbtiles.js`, `geokoder.js`
- `src/utils.js` — `filterSource`, `filterSources` (based on `minimatch`), `fetchJson`, `getGeocoderOptions`, `querySource`, tile helpers

---

## createServer

```js
export async function createServer(configOverride = {})
```

- Loads config via `@feathersjs/configuration` (node-config)
- Applies the override key by key with `app.set(key, override)` (direct replacement, no deep merge)
- Initializes providers via `Providers.initialize(app)`, then logs with `Providers.get(app)`
- Returns `server` with `server.app` exposed

**Note**: node-config does not load a specific file for `NODE_ENV=test` — the warning
`"did not match any deployment config file names"` is expected, `default.cjs` is always loaded.

---

## Providers

```js
export async function createProviders(app) { ... }
```

- `providers.js` exports a single `createProviders(app)` async function — no singleton
- Calls the 4 factories in parallel and pushes non-null providers into `app.providers`
- In `server.js`: `await createProviders(app)` then `app.providers` directly
- In `routes.js`: `app.providers` directly, no import from `providers.js` needed

---

## Available Providers

### OpenDataFrance and OpenStreetMap
- One provider per public geocoding service, each exposing a single source: `OpenDataFrance` → `opendatafrance` (BAN on the IGN Géoplateforme, `https://data.geopf.fr/geocodage`), `OpenStreetMap` → `openstreetmap` (Nominatim)
- Config: `OpenDataFrance: true`, `OpenStreetMap: { language: 'fr' }` — an object value holds the options (`url`, `timeout`, `userAgent`, plus `osmServer`, `language`, `email` for OpenStreetMap)
- They replace the `node-geocoder` library and the former `NodeGeocoder` provider: `NodeGeocoder: { opendatafrance, openstreetmap }` is still read as a deprecated configuration (`getGeocoderOptions` in `src/utils.js`, with a warning)
- `querySource` (`src/utils.js`) skips the request when the source is filtered out, adds `source` to results and turns a failure into an empty result logged with `debug` — otherwise `routes.js` would log it as an error
- `OpenDataFrance`: the viewbox is only used to focus the search (center as `lat`/`lon`), filtering happens in `routes.js`; a zero limit is not sent as the API rejects it
- `OpenStreetMap`: a reverse query without result answers `{ error: 'Unable to geocode' }` with a 200 status; there is no `limit` parameter in reverse
- Forward results: have `formattedAddress`, `streetName`, `city`, `country`, etc. — these property names are read by the KDK client (`kdk/map/client/utils/utils.location.js`), do not rename them
- Reverse results: `formattedLabel` built as:
  - `opendatafrance`: `[streetNumber, streetName, city, country].filter(Boolean).join(' ')`
  - `openstreetmap`: `formattedAddress`

### Kano
- Config: `{ catalogFilter, services: { 'service-name': { featureLabel, baseQuery } } }`
- Connects to feathers-distributed services exposed by Kano
- `featureLabel`: array of lodash paths to properties (e.g. `['properties.name']`)
- Fallback: `properties.name`
- Uses `feathers-distributed` to discover remote services
- Reverse results: `formattedLabel` built from `source.keys` — first non-null value joined with spaces, set on `properties.formattedLabel`

### MBTiles
- Config: `{ layerName: { filepath, layers: [...], featureLabel? } }`
- Geocoding against local `.mbtiles` files
- **Only supports reverse** — does not appear in `capabilities/forward`
- Each layer is exposed as a separate source: `layerName:layerName` (e.g. `mairies:mairies`)
- Reverse results: `formattedLabel` set on `properties.formattedLabel` via the `featureLabel(feature)` function from config

### Geokoder (proxy)
- Config: `{ proxyName: { url, filter?, headers? } }`
- Proxies to another geokoder instance
- The key name becomes the source prefix: `{ upstream: { url: '...' } }` → sources `upstream:openstreetmap`
- **Important**: uses `_.cloneDeep` to read config (not `config.util.toObject`) because in tests the config is a plain object without node-config methods
- Filter construction for upstream requests: single source → `sourceName`, multiple → `{source1,source2}` (minimatch glob)
- Reverse results: forwards `formattedLabel` as returned by the upstream instance
- **Pitfall**: `getSources` must be called with the correct operation (`'forward'` or `'reverse'`) — passing `'forward'` in the reverse handler causes reverse-only sources (e.g. MBTiles) to be silently excluded

---

## formattedLabel

All providers set `properties.formattedLabel` on reverse results. It is propagated as-is in `routes.js`:

```js
normalized.geokoder = {
  source: entry.source
}
// formattedLabel lives in entry.feature.properties, already set by the provider
```

| Provider | Strategy |
|---|---|
| OpenDataFrance | `[streetNumber, streetName, city, country].filter(Boolean).join(' ')` |
| OpenStreetMap | `formattedAddress` |
| Kano | First non-null value across `source.keys`, joined with spaces |
| MBTiles | `featureLabel(feature)` function from config |
| Geokoder | Forwarded from upstream |

---

## Source Filtering

```js
filterSource(name, filter)    // minimatch on a single name
filterSources(sources, filter) // filters an array
```

- `/` are replaced by `_` before minimatch
- Supported patterns: `*`, `open*`, `{openstreetmap,opendatafrance}`, `upstream:*`, etc.
- **Pitfall**: `*(foo)` is a minimatch extglob that matches everything — do not use it as a wrapper

---

## Routes

### GET `/capabilities/:operation`
- `operation`: `forward` or `reverse`
- Returns `{ geocoders: [...], i18n: ... }`
- Aggregates capabilities from all providers implementing the operation, sources are listed in the providers order

### GET `/forward`
- Params: `q`, `sources` (filter), `limit`, `viewbox` (`lon1,lat1,lon2,lat2`)
- Returns an array of GeoJSON Features with `geokoder: { source, match, matchProp }`
- Results are scored and sorted via `scoreForwardResults` + `sortAndLimitResults`

### GET `/reverse`
- Params: `lat`, `lon`, `sources`, `limit`, `distance`
- Returns an array of GeoJSON Features with `geokoder: { source }`
- `properties.formattedLabel` is set by each provider

---

## API Reference

See `service-geokoder-openapi.yaml` for the full OpenAPI 3.0 spec.

---

## Tests

- Framework: **vitest**
- `test/*.unit.test.js`: unit tests of the `OpenDataFrance`/`OpenStreetMap` providers and of the helpers, with an injected `fetch` (`fetch` option) and responses captured from the real services in `test/data/geocoders/` — no network; shared helpers in `test/helpers.js`
- `test/opendatafrance-openstreetmap.test.js`: integration tests against the real BAN and Nominatim services
- File: `test/geokoder.test.js`
- Creates two servers in the same process: `remoteServer` (port 8450, real providers) and `server` (port 8451, Geokoder proxy provider only)
- Server 8451 receives its config via `configOverride`: `{ port: 8451, providers: { Geokoder: { remote: { url: 'http://localhost:8450/api' } } } }`
- **Pitfall**: both servers run in the same process — `Providers` must be bound to `app` and not to the singleton to avoid conflicts
- Some tests depend on external APIs (opendatafrance, openstreetmap) → potentially unstable results
- MBTiles sources are exposed as `layerName:layerName` (e.g. `remote:mairies:mairies` through the proxy) — use this form in `sources` filter params and capability assertions
