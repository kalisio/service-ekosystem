import makeDebug from 'debug'
import _ from 'lodash'
import { validateGeoJson as validateGeoJsonStructure } from '@kalisio/common-geospatial'

const debug = makeDebug('kapture:utils:geojson')

export function validateGeoJson (content) {
  // check the crs first
  if (content.crs) {
    debug('validateGeoJson: check crs', content.crs)
    // we support only named crs and expressed in WGS84
    const name = _.get(content.crs, 'properties.name')
    if (name) {
      const crs = name.toLowerCase()
      const allowedCrs = ['epsg:4326', 'urn:ogc:def:crs:OGC:1.3:CRS84', 'urn:ogc:def:crs:EPSG::4326']
      const isCrsValid = _.some(allowedCrs, (allowrdCrs) => { return allowrdCrs.toLowerCase() === crs })
      if (!isCrsValid) {
        return [{ message: `Invalid CRS: ${crs}` }]
      }
      delete content.crs
    }
  }
  // validate the geojson structure
  // NOTE: @kalisio/common-geospatial@0.5.0 throws when validating a FeatureCollection
  // that contains an invalid feature (statistics aggregation bug), so we validate each
  // feature individually — the per-feature path is unaffected — and aggregate the errors.
  if (content.type === 'FeatureCollection' && _.isArray(content.features) && content.features.length > 0) {
    const errors = _.flatMap(content.features, (feature, index) => {
      return validateGeoJsonStructure(feature).errors.map(error => {
        return { ...error, path: `/features/${index}${error.path || ''}` }
      })
    })
    debug('validateGeoJson: validation errors', errors)
    return errors
  }
  const { errors } = validateGeoJsonStructure(content)
  debug('validateGeoJson: validation errors', errors)
  return errors
}
