import _ from 'lodash'
import { minimatch } from 'minimatch'

const GEOMETRY_TYPES = ['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon', 'GeometryCollection']

export function filterSource (name, filter) {
  return filter ? minimatch(_.replace(name, '/', '_'), _.replace(filter, '/', '_')) : true
}

export function filterSources (sources, filter) {
  return _.filter(sources, (source) => filterSource(source.name, filter))
}

// Extract a GeoJSON geometry from a geometry or a feature, returns null if not valid
export function toGeometry (input) {
  const geometry = _.get(input, 'type') === 'Feature' ? _.get(input, 'geometry') : input
  if (!_.isPlainObject(geometry) || !GEOMETRY_TYPES.includes(geometry.type)) return null
  if (geometry.type === 'GeometryCollection') {
    return Array.isArray(geometry.geometries) && geometry.geometries.every(toGeometry) ? geometry : null
  }
  return Array.isArray(geometry.coordinates) ? geometry : null
}

// SQL helpers, only applied to values coming from the configuration, never to user input
// which always goes through prepared statement parameters
export function quoteIdentifier (name) {
  return `"${String(name).replaceAll('"', '""')}"`
}

export function quoteLiteral (value) {
  return `'${String(value).replaceAll("'", "''")}'`
}
