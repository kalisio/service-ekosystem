import _ from 'lodash'
import makeDebug from 'debug'
import { fetchJson, getGeocoderOptions, querySource } from '../utils.js'

// French national address database (BAN), served by the IGN Géoplateforme
// cf. https://geoservices.ign.fr/documentation/services/services-geoplateforme/geocodage

const debug = makeDebug('geokoder:providers:opendatafrance')

const SOURCE = 'opendatafrance'
const DEFAULT_URL = 'https://data.geopf.fr/geocodage'

// Property used to score a forward result against the query, depends on the result type
const MATCH_PROPS = {
  municipality: 'city',
  locality: 'streetName',
  street: 'streetName',
  housenumber: 'streetName'
}

function toFeature (result) {
  const props = result.properties
  const properties = {
    state: props.context,
    city: props.city,
    zipcode: props.postcode,
    citycode: props.citycode,
    countryCode: 'FR',
    country: 'France',
    type: props.type,
    id: props.id
  }
  if (props.type === 'housenumber') {
    properties.streetName = props.street
    properties.streetNumber = props.housenumber
  } else if ((props.type === 'street') || (props.type === 'locality')) {
    properties.streetName = props.name
  } else if (props.type === 'municipality') {
    properties.population = props.population
  }
  const [longitude, latitude] = result.geometry.coordinates
  return { type: 'Feature', properties, geometry: { type: 'Point', coordinates: [longitude, latitude] } }
}

export async function createOpenDataFranceProvider (app) {
  const options = getGeocoderOptions(app, { provider: 'OpenDataFrance', source: SOURCE })
  if (!options) { return null }

  const url = options.url || DEFAULT_URL
  const request = {
    headers: { 'user-agent': options.userAgent, accept: 'application/json' },
    timeout: options.timeout,
    fetch: options.fetch
  }

  async function query (endpoint, params) {
    debug(`Requesting ${endpoint} with parameters`, params)
    const response = await fetchJson(`${url}/${endpoint}`, { ...request, params })
    return _.get(response, 'features', [])
  }

  return {
    name: 'OpenDataFrance',

    capabilities ({ operation }) {
      return [SOURCE]
    },

    async forward ({ search, filter, limit, viewbox }) {
      return querySource(SOURCE, filter, async () => {
        // A zero limit means no limit while the API rejects it, so we only send a strictly positive one
        const params = { q: search, limit: limit || undefined }
        if (!_.isNil(viewbox)) {
          // The API cannot bound the search, so we focus it on the viewbox center
          // and features outside the viewbox are filtered out afterwards
          params.lat = viewbox.minLat + ((viewbox.maxLat - viewbox.minLat) / 2)
          params.lon = viewbox.minLon + ((viewbox.maxLon - viewbox.minLon) / 2)
        }
        const results = await query('search', params)
        return results.map((result) => {
          const feature = toFeature(result)
          const matchProp = MATCH_PROPS[feature.properties.type] || 'city'
          return { feature, matchProp, match: _.get(feature.properties, matchProp) ?? '' }
        })
      }, debug)
    },

    async reverse ({ lat, lon, filter, limit }) {
      return querySource(SOURCE, filter, async () => {
        const results = await query('reverse', { lat, lon, limit: limit || undefined })
        return results.map((result) => {
          const feature = toFeature(result)
          const { streetNumber, streetName, city, country } = feature.properties
          feature.properties.formattedLabel = [streetNumber, streetName, city, country].filter(Boolean).join(' ')
          return { feature }
        })
      }, debug)
    }
  }
}
