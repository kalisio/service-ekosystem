---
title: service-geokoder
description: Lightweight geocoder service providing forward and reverse geocoding
---

# service-geokoder

_Lightweight geocoder service providing forward and reverse geocoding_

## Overview

**service-geokoder** is a service that allows you to perform forward and reverse geocoding using various sources exposed by different providers. The following providers are currently supported:

* `Kano` — exposes [Kano](https://kalisio.github.io/kano/) catalog layers as geocoding sources.
* `NodeGeocoder` — exposes providers supported by [node-geocoder](https://nchaulet.github.io/node-geocoder/) as geocoding sources.
* `MBTiles` — exposes layers from [MBTiles](https://wiki.openstreetmap.org/wiki/MBTiles) as geocoding sources.
* `Geokoder` — proxies requests to another **service-geokoder** instance, exposing the proxied sources locally under a configurable prefix.

## Installation

Install with your preferred package manager:

::: code-group

```bash [pnpm]
pnpm add @kalisio/service-geokoder
```

```bash [npm]
npm install @kalisio/service-geokoder
```

```bash [yarn]
yarn add @kalisio/service-geokoder
```

:::

## Configuration

### local.cjs

By default, **service-geokoder** does not expose any sources. You are responsible to write a `local.cjs` file to declare the different sources you want to expose.

Here is an example file that exposes all the sources from the **Kano** provider, `opendatafrance` from the **NodeGeocoder** provider, `api-geo` dataset sources from the **MBTiles** provider and all the sources matching `*hubeau*` from a remote geokoder instance:

```js
module.exports = {
  providers: {
    Kano: {
      catalogFilter: 'hubeau-*'
    },
    NodeGeocoder: {
      opendatafrance: true
    },
    MBTiles: {
      'api-geo': { filepath: '/mnt/data/api-geo-5m.mbtiles', layers: ['communes5m', 'epci5m', 'departements5m', 'regions5m'] }
    },
    Geokoder: {
      'some-name': { url: 'https://some.remote.url/blabla', filter: '*hubeau*', headers: { 'Authorization': 'Bearer eyblablablablablabla' } }
    }
  }
}
```

#### Kano

Each layer in the `catalog` service exposing the `featureLabel` property will be taken into account. This property can be a single string value or an array of strings to target multiple fields.

These *catalog* layers can be filtered using the configuration key `catalogFilter`. This string is a [minimatch](https://github.com/isaacs/minimatch#minimatch) expression, the layer's service name will be matched against the expression.

``` js
Kano: {
  catalogFilter: 'hubeau-*'
}
```

In addition to using exposed **Kano** layers from the `catalog` service, it is also possible to use additional distributed services. Services are declared using the following formalism:

```js
services: {
  'service_name': {
     featureLabel: ['properties.fiel_name'],  // Default value is ['properties.name']
     baseQuery: { query }  // Default value is undefined
  }
}
```

> [!NOTE]
> When dealing with [KDK](https://kalisio.github.io/kdk/)-based applications and wanting to use contextual distributed services, you need to declare the services such as the following example:
> ```js
> services: {
>   '*/measures': {
>      featureLabel: ['properties.location']
>   }
> }
> ```

#### NodeGeocoder

Each key is a geocoder to instantiate in [node-geocoder](https://github.com/nchaulet/node-geocoder). If value is false-ish, it won't be instanciated. If you'd like to pass additional options to the geocoder instance then it could be an object containing the options.

```js
NodeGeocoder: {
  opendatafrance: true,
  openstreetmap: false
}
```

#### MBtiles

Each key will be a new dataset based on the provided file and exposing some layers as sources such as:

`admin-express': { filepath: path.join(__dirname, '../data/mbtiles/admin-express.mbtiles'), layers: ['commune', 'departement']`.

> [!NOTE]
> For performance reason each layer in a dataset should have the same max zoom level, if not two different datasets should be created for now.

#### Geokoder

Each key will generate all the sources that match the defined source `filter` on the remote geokoder instance.
Eg, if you have a remote geokoder located at `https://some.remote.url/blabla` exposing sources `hubeau-hydro`, `hubeau-piezo`, `opendatafrance` and `api-geo` sources, then the following configuration:

```
'some-name': { url: 'https://some.remote.url/blabla', filter: '*hubeau*', headers: { 'Authorization': 'Bearer eyblablablablablabla' } }
```

will expose on the local geokoder `some-name:hubeau-hydro` and `some-name:hubeau-piezo` as if they were local sources.

### i18n

**geokoder** allows you to declare **i18n** files which can be used to name the different exposed sources in an understandable way. This description is returned within an `i18n` object when requestring the capabilities.

An i18n file consists in a javascript file strucuted as below:

```js
module.exports = {
  i18n: {
    fr: {
      Geocoders: {
        'kano:hubeau-hydro-stations': 'Hub\'Eau Hydrométrie',
        'kano:hubeau-piezo-stations': 'Hub\'Eau Piezométrie',
        'kano:icos-stations': 'Réseau ICOS',
        'opendatafrance': 'BAN'
        // ...
      }
    },
    en: {
      Geocoders: {
        'kano:hubeau-hydro-stations': 'Hub\'Eau Hydrometry',
        'kano:hubeau-piezo-stations': 'Hub\'Eau Piezometry',
        'kano:icos-stations': 'ICOS Network',
        'opendatafrance': 'BAN'
        // ...
      }
    }
  }
}
```

### Environment variables

Here are the environment variables you can use to customize the service:

| Variable  | Description | Defaults |
|-----------| ------------| ------------|
| `PORT` | The port to be used when exposing the service |  `8080` |
| `HOSTNAME` | The hostname to be used when exposing the service | `localhost` |
| `API_PATH` | The path to the API |
| `API_URL` | The url used when exposing the service | `localhost:8080/api` |

## API

The HTTP API exposed by **service-geokoder** is documented on the [API reference](./service-geokoder-openapi) page.