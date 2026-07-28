import _ from 'lodash'
import makeDebug from 'debug'
import { errors as ferrors } from '@feathersjs/errors'
import { stripSlashes } from '@feathersjs/commons'

const debug = makeDebug('geokatcher:providers:kano')

export async function initKano (app) {
  const apiPath = app.get('apiPath')
  // Notifies the app when the Kano services are ready
  const interval = setInterval(() => {
    if (kanoServiceAvailable()) {
      clearInterval(interval)
      app.logger.info('Kano services are ready')
      debug('Kano services are ready')
      app.emit('kano:ready')
    } else {
      app.logger.info('Waiting for Kano services to be ready...')
      debug('Waiting for Kano services to be ready...')
    }
  }, 2000)

  // Use the catalog service to build a list of sources (ie. feature services we can use)
  function kanoServiceAvailable () {
    // We check if the catalog service is available, if so we assume the Kano services are ready
    return app.services[stripSlashes(`${apiPath}/catalog`)] !== undefined
  }
  return {
    /**
     * Check if the Kano services are ready.
     * @returns {Promise<boolean>} - A promise that resolves to true if the Kano services are ready, and false otherwise.
     */
    areKanoServicesReady () {
      return kanoServiceAvailable()
    },

    /**
     * Retrieve the data of a layer based on the provided layer name.
     * @param {string} name - The name of the layer.
     * @returns {Promise<Object>} - The data of the layer.
     * @throws {ferrors.BadRequest} - If the layer name is not provided.
     * @throws {ferrors.Unavailable} - If the Kano services are not ready.
     * @throws {ferrors.NotFound} - If the layer is not found.
     */
    async getLayerData (name) {
      if (!name) {
        throw new ferrors.BadRequest('Layer name is required')
      }
      if (!kanoServiceAvailable()) {
        throw new ferrors.Unavailable('Kano services are not ready')
      }
      const catalog = app.service(`${apiPath}/catalog`)
      const layer = await catalog.find({
        query: {
          $and: [
            {
              $or: [
                { service: { $exists: true } },
                { probeService: { $exists: true } }
              ]
            },
            {
              $or: [
                { name: `Layers.${name.toUpperCase()}` },
                { name },
                { _id: name }
              ]
            }
          ]
        }
      })
      if (!layer.data || layer.data.length === 0) {
        throw new ferrors.NotFound('Layer not found', { layer: name })
      }
      return layer.data[0]
    },

    /**
     * Retrieve the features of a layer based on the provided layer object and filter.
     * @param {Object} layer - The layer object.
     * @param {Object} filter - The filter to apply to the query.
     * @returns {Promise<Array>} - The result of the query.
     * @throws {ferrors.Unavailable} - If the Kano services are not ready.
     * @throws {ferrors.BadRequest} - If the layer is not provided.
     * @throws {ferrors.GeneralError} - If the query results were limited by the service.
     */
    async getLayerFeatures (layer, filter) {
      if (!kanoServiceAvailable()) {
        throw new ferrors.Unavailable('Kano services are not ready')
      }
      if (!layer) {
        throw new ferrors.BadRequest('Layer is required')
      }
      let query = {}
      // collection is serviceProbe (if exists) or service
      const collection = _.get(layer, 'probeService', layer.service)
      // If the collection is features, we need to add the layer to the query to only get the features of the layer
      if (collection === 'features') {
        query = {
          layer: layer._id
        }
      }
      // If a filter is provided we need to add it to the query
      if (filter) {
        query = {
          ...query,
          ...filter
        }
      }
      const service = app.service(`${apiPath}/${collection}`)
      const result = await service.find({
        query
      })

      // if result.total is bigger than the size of result.features, we need to throw an error
      if (result.total > result.features.length) {
        throw new ferrors.GeneralError('Query results were limited by the service.', { layer: layer.name, service: collection, total: result.total, returned: result.features.length })
      }
      return result
    },

    /**
     * Compare layers and check if each feature geometry inside the zone is inside the target geometry.
     * @param {Object} targetFeatureCollection - The feature collection of the target.
     * @param {Object} zoneLayer - The layer object of the zone.
     * @param {Object} zoneFilter - The filter to apply to the query.
     * @param {Object} monitor - The monitor object.
     * @returns {Promise<Object>} - The feature collection of the target.
     * @throws {GeneralError} - If the query for the layer was limited by the service.
     */
    async compareLayers (targetFeatureCollection, zoneLayer, zoneFilter, monitor) {
      const targetFeatures = []
      const collection = _.get(zoneLayer, 'probeService', zoneLayer.service)
      const service = app.services[stripSlashes(`${apiPath}/${collection}`)]
      await Promise.all(targetFeatureCollection.features.map(async (zone) => {
        let geometry
        let query = {}
        // We get the geometry query to inject in the query based on the evaluation type
        try {
          geometry = injectGeoQuery(monitor, zone)
        } catch (err) {
          if (err instanceof ferrors.NotAcceptable) {
            app.logger.error(err.message)
            return
          }
          // If we have an other error, we let the error propagate to the caller
          throw err
        }
        if (zoneFilter) {
          query.$and = [
            zoneFilter,
            geometry
          ]
        } else {
          query = geometry
        }
        if (collection === 'features') {
          query.layer = zoneLayer._id
        }

        // console.log(`Query: ${JSON.stringify(query)} on collection ${collection}`)
        const result = await service.find({ query })
        if (result.total !== result.features.length) {
          throw new ferrors.GeneralError('Query for the layer was limited by the service.', { layer: zoneLayer.name, service: collection, total: result.total, returned: result.features.length })
        }
        // We return the feature and the zone that intersect
        if (result.total > 0) {
          targetFeatures.push({ targetFeatures: zone, zoneFeatures: result.features.map((feature) => feature) })
        }
      }))
      return targetFeatures
    }
  }

  /**
 * Injects a geometry query based on the evaluation type and feature.
 * @param {Object} monitor - The monitor object.
 * @param {Object} feature - The feature object.
 * @returns {Object} - The injected geometry query.
 * @throws {ferrors.NotAcceptable} - If the feature geometry type is invalid for the evaluation type.
 * @throws {ferrors.BadRequest} - If the evaluation type is unrecognized.
 */
  function injectGeoQuery (monitor, feature) {
    let geometry
    const evaluation = _.get(monitor, 'evaluation.type')
    switch (evaluation) {
      case 'geoWithin':
      // geoWithin can only be used with Polygon or MultiPolygon geometries
        if (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon') {
          throw new ferrors.NotAcceptable(`Invalid geometry type for evaluation type [${monitor.evaluation.type}] and zone [${feature.geometry.type}] : This zone will be ignored`)
        }
        geometry = {
          geometry: {
            $geoWithin: {
              $geometry: feature.geometry
            }
          }
        }
        break
      case 'geoIntersects':
      // geoIntersects can be used with any geometry type
        geometry = {
          geometry: {
            $geoIntersects: {
              $geometry: feature.geometry
            }
          }
        }
        break
      case 'near':
      // near can only be used with Point geometries
        if (feature.geometry.type !== 'Point') {
          throw new ferrors.NotAcceptable(`Invalid geometry type for evaluation type [${monitor.evaluation.type}] and zone [${feature.geometry.type}] : This zone will be ignored`)
        }
        monitor.evaluation.maxDistance = (typeof monitor.evaluation.maxDistance === 'number' ? monitor.evaluation.maxDistance : 1000)
        monitor.evaluation.minDistance = (typeof monitor.evaluation.minDistance === 'number' ? monitor.evaluation.minDistance : 0)

        geometry = {
          $and: [
            {
              geometry: {
                $geoWithin: {
                  $centerSphere: [feature.geometry.coordinates, monitor.evaluation.maxDistance / 6378137] // Earth radius as in radians
                }
              }
            },
            {
              geometry: {
                $not: {
                  $geoWithin: {
                    $centerSphere: [feature.geometry.coordinates, monitor.evaluation.minDistance / 6378137] // Earth radius as in radians
                  }
                }
              }
            }
          ]
        }
        // geometry = {
        //   geometry: {
        //     $geoWithin: {
        //       $centerSphere: [feature.geometry.coordinates, monitor.evaluation.maxDistance / 6378137] // Earth radius as in radians
        //     }
        //   }
        // }

        break
      default:
        throw new ferrors.BadRequest('Unrecognized evaluation type', { evaluation })
    }
    return geometry
  }
}
