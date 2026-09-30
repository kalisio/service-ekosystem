import _ from 'lodash'
import makeDebug from 'debug'
import { fetchJson, getGeocoderOptions, querySource } from '../utils.js'

// OpenStreetMap Nominatim, the public instance requires a valid User-Agent and at most 1 request per second
// cf. https://nominatim.org/release-docs/latest/api/Overview/ and https://operations.osmfoundation.org/policies/nominatim/

const debug = makeDebug('geokoder:providers:openstreetmap')

const SOURCE = 'openstreetmap'
const DEFAULT_URL = 'https://nominatim.openstreetmap.org'

function toFeature (result) {
  const address = result.address || {}
  const properties = {
    formattedAddress: result.display_name,
    country: address.country,
    city: address.city || address.town || address.village || address.hamlet,
    state: address.state,
    zipcode: address.postcode,
    streetName: address.road || address.cycleway,
    streetNumber: address.house_number,
    countryCode: address.country_code ? address.country_code.toUpperCase() : undefined,
    neighbourhood: address.neighbourhood || ''
  }
  const longitude = result.lon ? parseFloat(result.lon) : undefined
  const latitude = result.lat ? parseFloat(result.lat) : undefined
  return { type: 'Feature', properties, geometry: { type: 'Point', coordinates: [longitude, latitude] } }
}

export async function createOpenStreetMapProvider (app) {
  const options = getGeocoderOptions(app, { provider: 'OpenStreetMap', source: SOURCE })
  if (!options) { return null }

  // osmServer is the option name inherited from node-geocoder
  const url = options.url || options.osmServer || DEFAULT_URL
  const request = {
    headers: { 'user-agent': options.userAgent, accept: 'application/json' },
    timeout: options.timeout,
    fetch: options.fetch
  }
  const commonParams = {
    format: 'json',
    addressdetails: 1,
    'accept-language': options.language,
    email: options.email
  }

  async function query (endpoint, params) {
    debug(`Requesting ${endpoint} with parameters`, params)
    const response = await fetchJson(`${url}/${endpoint}`, { ...request, params: { ...commonParams, ...params } })
    // Nominatim answers with a 200 status and an error message when nothing is found by a reverse query
    if (response.error) throw new Error(response.error)
    return _.castArray(response)
  }

  return {
    name: 'OpenStreetMap',

    capabilities ({ operation }) {
      return [SOURCE]
    },

    async forward ({ search, filter, limit, viewbox }) {
      return querySource(SOURCE, filter, async () => {
        const params = { q: search, limit }
        if (!_.isNil(viewbox)) {
          // cf. https://nominatim.org/release-docs/latest/api/Search/#result-restriction
          params.viewbox = `${viewbox.minLon},${viewbox.minLat},${viewbox.maxLon},${viewbox.maxLat}`
          params.bounded = 1
        }
        const results = await query('search', params)
        return results.map((result) => {
          const feature = toFeature(result)
          return { feature, matchProp: 'formattedAddress', match: feature.properties.formattedAddress ?? '' }
        })
      }, debug)
    },

    async reverse ({ lat, lon, filter }) {
      return querySource(SOURCE, filter, async () => {
        // Nominatim reverse geocoding always returns a single result, there is no limit parameter
        const results = await query('reverse', { lat, lon })
        return results.map((result) => {
          const feature = toFeature(result)
          feature.properties.formattedLabel = feature.properties.formattedAddress
          return { feature }
        })
      }, debug)
    }
  }
}
