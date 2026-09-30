import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'fs-extra'
import _ from 'lodash'
import { minimatch } from 'minimatch'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageInfo = fs.readJsonSync(path.join(__dirname, '..', 'package.json'))

// Default timeout in ms of the requests issued to geocoding services
const DEFAULT_TIMEOUT = 10000

export function filterSource (name, filter) {
  return filter ? minimatch(_.replace(name, '/', '_'), _.replace(filter, '/', '_')) : true
}

export function filterSources (sources, filter) {
  return _.filter(sources, (source) => filterSource(source.name, filter))
}

// Issue a GET request and parse the JSON response, nil parameters are dropped from the query string
export async function fetchJson (url, { params, headers, timeout, fetch: fetchFn = fetch } = {}) {
  const query = new URLSearchParams(_.omitBy(params, _.isNil)).toString()
  const response = await fetchFn(query ? `${url}?${query}` : url, {
    headers,
    signal: timeout ? AbortSignal.timeout(timeout) : undefined
  })
  if (!response.ok) throw new Error(`Request to ${url} failed with status ${response.status}`)
  return response.json()
}

// Retrieve the options of a provider wrapping a geocoding service, or null if it is not enabled.
export function getGeocoderOptions (app, { provider, source }) {
  const providers = app.get('providers')
  const deprecatedKey = ['NodeGeocoder', source]
  let config
  if (_.has(providers, provider)) {
    config = _.get(providers, provider)
    if (_.has(providers, deprecatedKey)) {
      app.logger.warn(`${provider} provider: the deprecated NodeGeocoder.${source} configuration is ignored as a ${provider} one is defined`)
    }
  } else if (_.has(providers, deprecatedKey)) {
    config = _.get(providers, deprecatedKey)
    if (config) app.logger.warn(`${provider} provider: the NodeGeocoder.${source} configuration is deprecated, please use ${provider} instead`)
  }
  // If value is false-ish the provider is disabled
  if (!config) return null
  // Public geocoding services usually require a valid User-Agent
  // see e.g. https://operations.osmfoundation.org/policies/nominatim/
  const defaults = { userAgent: `geokoder/${packageInfo.version}`, timeout: DEFAULT_TIMEOUT }
  // If not simply an enabled/disabled flag then we might have additional options
  return { ...defaults, ...(typeof config === 'object' ? config : {}) }
}

// Run a request on a provider exposing a single source: skip it when the source is filtered out,
// tag results with the source and ignore failures so that other providers can still answer
export async function querySource (source, filter, request, debug) {
  if (!filterSource(source, filter)) return []
  try {
    const entries = await request()
    debug(`Retrieved ${entries.length} entries from source ${source}`)
    return entries.map((entry) => ({ source, ...entry }))
  } catch (error) {
    debug(`Request to ${source} failed:`, error)
    return []
  }
}

export function long2tile (lon, zoom) {
  return (Math.floor((lon + 180) / 360 * Math.pow(2, zoom)))
}
export function lat2tile (lat, zoom) {
  return (Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom)))
}
