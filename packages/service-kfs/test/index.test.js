import utility from 'util'
import { describe, it, expect, afterAll } from 'vitest'
import assert from 'assert'
import _ from 'lodash'
import path from 'path'
import fs from 'fs-extra'
import request from 'superagent'
import siftModule from 'sift'
import { fileURLToPath } from 'url'
import moment from 'moment'
import distribution, { finalize } from '@kalisio/feathers-distributed'
import { kdk } from '@kalisio/kdk/core.api.js'
import { createFeaturesService, createCatalogService } from '@kalisio/kdk/map.api.js'
import { getCollectionName } from '../src/utils.js'
import { createServer } from '../src/server.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const modelsPath = path.join(__dirname, 'models')
const servicesPath = path.join(__dirname, 'services')
const sift = siftModule.default

// Test suite based on using the catalog service or not
// and using features service or not
function runTests (options = {
  catalog: true,
  features: true
}) {
  let app, server, baseUrl,
    kapp, catalogService, defaultLayers, hubeauStationsService, hubeauObsService, hubeauFilteredService,
    nbStations, nbStationsWithNullInfluLocal, nbStationsLIMNI, nbStationsLIMNIWithNullInfluLocal, nbObservations, feature
  const nbFilteredStations = []
  const nbPerPage = 200

  it('initialize the remote app', async () => {
    kapp = kdk()
    // Distribute services
    await kapp.configure(distribution({
      // Use cote defaults to speedup tests
      cote: {
        helloInterval: 2000,
        checkInterval: 4000,
        nodeTimeout: 5000,
        masterTimeout: 6000
      },
      publicationDelay: 3000,
      key: 'kfs-test',
      // Distribute only the test services
      services: (service) => (service.path.includes('hubeau') && !service.path.includes('filtered')) ||
                (options.catalog && service.path.includes('catalog')),
      // Distribute at least modelName and pagination for KFS to know about features services
      remoteServiceOptions: () => ['modelName', 'paginate']
    }))
    await kapp.db.connect()
    // Create a global catalog service
    if (options.catalog) {
      await createCatalogService.call(kapp)
      catalogService = kapp.getService('catalog')
      expect(catalogService).toBeDefined()
    }
  })

  it('registers the default layers', async () => {
    const layers = await fs.readJson(path.join(__dirname, 'config/layers.json'))
    expect(layers.length > 0).toBe(true)
    // Create layers
    if (options.catalog) defaultLayers = await catalogService.create(layers)
    else defaultLayers = layers
    // Single layer case
    if (!Array.isArray(defaultLayers)) defaultLayers = [defaultLayers]
    expect(defaultLayers.length > 0).toBe(true)
  })

  it('create and feed the hubeau stations service', async () => {
    // Create the services
    const hubeauLayer = _.find(defaultLayers, { name: 'Layers.HUBEAU' })
    expect(hubeauLayer).toBeDefined()
    expect(hubeauLayer.probeService === 'hubeau-stations').toBe(true)
    if (options.features) {
      await createFeaturesService.call(kapp, {
        collection: hubeauLayer.probeService,
        featureId: hubeauLayer.featureId,
        paginate: { default: nbPerPage }
      })
    } else {
      await kapp.createService('hubeau-stations', {
        modelsPath,
        servicesPath,
        paginate: { default: nbPerPage }
      })
    }
    hubeauStationsService = kapp.getService(hubeauLayer.probeService)
    expect(hubeauStationsService).toBeDefined()
    // Feed the collection
    let stations = fs.readJsonSync(path.join(__dirname, 'data/hubeau.stations.json')).features
    nbStations = stations.length
    // Count stations for each filter
    hubeauLayer.filters.forEach(filter => {
      nbFilteredStations.push(stations.filter(sift(filter.active)).length)
    })
    nbStationsWithNullInfluLocal = stations.filter(station => !station.properties.InfluLocal).length
    nbStationsLIMNI = stations.filter(station => station.properties.TypStation === 'LIMNI').length
    nbStationsLIMNIWithNullInfluLocal = stations.filter(station => station.properties.TypStation === 'LIMNI' && !station.properties.InfluLocal).length
    stations = await hubeauStationsService.create(stations)
    feature = stations[Math.floor(Math.random() * nbStations)]
  })

  it('create and feed the hubeau observations service', async () => {
    // Create the service
    const hubeauLayer = _.find(defaultLayers, { name: 'Layers.HUBEAU' })
    expect(hubeauLayer).toBeDefined()
    expect(hubeauLayer.service === 'hubeau-observations').toBe(true)
    if (options.features) {
      await createFeaturesService.call(kapp, {
        collection: hubeauLayer.service,
        featureId: hubeauLayer.featureId,
        paginate: { default: nbPerPage }
      })
    } else {
      await kapp.createService('hubeau-observations', {
        modelsPath,
        servicesPath,
        paginate: { default: nbPerPage }
      })
    }
    hubeauObsService = kapp.getService(hubeauLayer.service)
    expect(hubeauObsService).toBeDefined()
    // Feed the collection, most observations have H = 0.33 with a few exceptions:
    // First one with H = 0.63, second to last four ones with H = 0.43, last four ones with H = 0.53
    const observations = fs.readJsonSync(path.join(__dirname, 'data/hubeau.observations.json'))
    nbObservations = observations.length
    // Take care that in this case no hook will convert time correctly
    if (!options.features) observations.forEach(observation => { observation.time = new Date(observation.time) })
    await hubeauObsService.create(observations)
  })

  it('create and feed the hubeau filtered service', async () => {
    // Create the service
    const hubeauLayer = _.find(defaultLayers, { name: 'Layers.FILTERED_SERVICE' })
    expect(hubeauLayer).toBeDefined()
    expect(hubeauLayer.service === 'hubeau-filtered').toBe(true)
    if (options.features) {
      await createFeaturesService.call(kapp, {
        collection: hubeauLayer.service,
        featureId: hubeauLayer.featureId,
        paginate: { default: nbPerPage }
      })
    } else {
      await kapp.createService('hubeau-filtered', {
        modelsPath,
        servicesPath,
        paginate: { default: nbPerPage }
      })
    }
    hubeauFilteredService = kapp.getService(hubeauLayer.service)
    expect(hubeauFilteredService).toBeDefined()
  })

  it('initialize the app', async () => {
    server = await createServer()
    expect(server).toBeDefined()
    app = server.app
    expect(app).toBeDefined()
    baseUrl = app.get('baseUrl')
    // Wait long enough to be sure distribution is up
    await utility.promisify(setTimeout)(10000)
  })

  it('get landing page', async () => {
    const response = await request.get(`${baseUrl}`)
    expect(response.body.links).toBeDefined()
    expect(response.body.links.length).toBe(4)
    response.body.links.forEach(link => {
      expect(link.href).toBeDefined()
      expect(link.rel).toBeDefined()
    })
  })

  it('get conformance page', async () => {
    const response = await request.get(`${baseUrl}/conformance`)
    expect(response.body.conformsTo).toBeDefined()
  })

  it('get api definition', async () => {
    const response = await request.get(`${baseUrl}/definition`)
    expect(response.body.paths).toBeDefined()
  })

  it('get collections', async () => {
    const response = await request.get(`${baseUrl}/collections`)
    expect(response.body.collections).toBeDefined()
    // We should have hubeau stations + measures collection
    // and this twice again as the layer declares two filters
    expect(response.body.collections.length).toBe(options.catalog && options.features ? 6 : 2)
    expect(response.body.links).toBeDefined()
    expect(response.body.links.length).toBe(1)
    response.body.links.forEach(link => {
      expect(link.href).toBeDefined()
      expect(link.rel).toBeDefined()
    })
  })

  it('get collection', async () => {
    const response = await request.get(`${baseUrl}/collections/hubeau-stations`)
    expect(response.body.id).toBeDefined()
    expect(response.body.id).toBe('hubeau-stations')
    expect(response.body.itemType).toBeDefined()
    expect(response.body.itemType).toBe('feature')
    expect(response.body.title).toBeDefined()
    // When not using layers we don't have this information
    if (options.catalog) {
      expect(response.body.description).toBeDefined()
      expect(response.body.extent).toBeDefined()
      expect(response.body.extent.spatial).toBeDefined()
      expect(response.body.extent.spatial.bbox).toBeDefined()
      expect(response.body.extent.spatial.crs).toBeDefined()
      expect(response.body.extent.temporal).toBeDefined()
      expect(response.body.extent.temporal.interval).toBeDefined()
      expect(response.body.extent.temporal.interval.length).toBe(1)
      expect(response.body.extent.temporal.interval[0].length).toBe(2)
      expect(response.body.extent.temporal.interval[0][0]).not.toBe(null)
      expect(response.body.extent.temporal.interval[0][1]).not.toBe(null)
      expect(response.body.extent.temporal.trs).toBeDefined()
      expect(response.body.defaultSortOrder).toBeDefined()
      expect(response.body.defaultSortOrder).toEqual(['-time'])
    }
    expect(response.body.crs).toBeDefined()
    expect(response.body.links).toBeDefined()
    expect(response.body.links.length).toBe(2)
    response.body.links.forEach(link => {
      expect(link.href).toBeDefined()
      expect(link.rel).toBeDefined()
    })
  })

  // When not using layers we don't have filter collections
  if (options.catalog && options.features) {
    it('get filter collection', async () => {
      const hubeauLayer = _.find(defaultLayers, { name: 'Layers.HUBEAU' })
      const filter = hubeauLayer.filters[0]
      const filterName = _.get(hubeauLayer, `i18n.en.${filter.label}`)
      const collection = getCollectionName('hubeau-stations', filterName)
      const response = await request.get(`${baseUrl}/collections/${collection}`)
      expect(response.body.id).toBeDefined()
      expect(response.body.id).toBe(collection)
      expect(response.body.itemType).toBeDefined()
      expect(response.body.itemType).toBe('feature')
      expect(response.body.title).toBeDefined()
      expect(response.body.description).toBeDefined()
      expect(response.body.extent).toBeDefined()
      expect(response.body.extent.spatial).toBeDefined()
      expect(response.body.extent.spatial.bbox).toBeDefined()
      expect(response.body.extent.spatial.crs).toBeDefined()
      expect(response.body.extent.temporal).toBeDefined()
      expect(response.body.extent.temporal.interval).toBeDefined()
      expect(response.body.extent.temporal.interval.length).toBe(1)
      expect(response.body.extent.temporal.interval[0].length).toBe(2)
      expect(response.body.extent.temporal.interval[0][0]).not.toBe(null)
      expect(response.body.extent.temporal.interval[0][1]).not.toBe(null)
      expect(response.body.extent.temporal.trs).toBeDefined()
      expect(response.body.defaultSortOrder).toBeDefined()
      expect(response.body.defaultSortOrder).toEqual(['-time'])
      expect(response.body.crs).toBeDefined()
      expect(response.body.links).toBeDefined()
      expect(response.body.links.length).toBe(2)
      response.body.links.forEach(link => {
        expect(link.href).toBeDefined()
        expect(link.rel).toBeDefined()
      })
    })
  }

  it('get nonexistent collection', async () => {
    try {
      await request.get(`${baseUrl}/collections/xxx`)
      assert.fail('getting nonexistent collection should raise on error')
    } catch (data) {
      const error = data.response.body
      expect(error).toBeDefined()
      expect(error.name).toBe('NotFound')
    }
  })

  it('get items', async () => {
    const response = await request.get(`${baseUrl}/collections/hubeau-stations/items`)
    expect(response.body.features).toBeDefined()
    expect(response.body.numberMatched).toBeDefined()
    expect(response.body.numberReturned).toBeDefined()
    expect(response.body.numberMatched).toBe(nbStations)
    expect(response.body.numberReturned).toBe(nbStations < nbPerPage ? nbStations : nbPerPage)
    response.body.links.forEach(link => {
      expect(link.href).toBeDefined()
      expect(link.href.includes('offset')).toBe(true)
      expect(link.href.includes('limit')).toBe(true)
      expect(link.rel).toBeDefined()
    })
  })

  // When not using layers we don't have filter collections
  if (options.catalog && options.features) {
    it('get filtered items', async () => {
      const hubeauLayer = _.find(defaultLayers, { name: 'Layers.HUBEAU' })
      for (let i = 0; i < hubeauLayer.filters.length; i++) {
        const filter = hubeauLayer.filters[i]
        const filterName = _.get(hubeauLayer, `i18n.en.${filter.label}`)
        const collection = getCollectionName('hubeau-stations', filterName)
        const response = await request.get(`${baseUrl}/collections/${collection}/items`)
        expect(response.body.features).toBeDefined()
        expect(response.body.numberMatched).toBeDefined()
        expect(response.body.numberReturned).toBeDefined()
        expect(response.body.numberMatched).toBe(nbFilteredStations[i])
        expect(response.body.numberReturned).toBe(nbFilteredStations[i] < nbPerPage ? nbFilteredStations[i] : nbPerPage)
        response.body.links.forEach(link => {
          expect(link.href).toBeDefined()
          expect(link.href.includes('offset')).toBe(true)
          expect(link.href.includes('limit')).toBe(true)
          expect(link.rel).toBeDefined()
        })
      }
    })
  }

  it('get sorted items', async () => {
    // Use a string property that actually contains a number so that comparisons are made easy
    let response = await request.get(`${baseUrl}/collections/hubeau-stations/items`)
      .query({ sortby: '+CdCommune' })
    expect(response.body.features).toBeDefined()
    expect(response.body.numberMatched).toBeDefined()
    expect(response.body.numberReturned).toBeDefined()
    expect(response.body.numberMatched).toBe(nbStations)
    expect(response.body.numberReturned).toBe(nbStations < nbPerPage ? nbStations : nbPerPage)
    let CdCommune, previousCdCommune
    response.body.features.forEach(feature => {
      CdCommune = Number(_.get(feature, 'properties.CdCommune'))
      if (previousCdCommune) expect(previousCdCommune <= CdCommune).toBe(true)
      previousCdCommune = CdCommune
    })
    response = await request.get(`${baseUrl}/collections/hubeau-stations/items`)
      .query({ sortby: '-CdCommune' })
    expect(response.body.features).toBeDefined()
    expect(response.body.numberMatched).toBeDefined()
    expect(response.body.numberReturned).toBeDefined()
    expect(response.body.numberMatched).toBe(nbStations)
    expect(response.body.numberReturned).toBe(nbStations < nbPerPage ? nbStations : nbPerPage)
    previousCdCommune = undefined
    response.body.features.forEach(feature => {
      CdCommune = Number(_.get(feature, 'properties.CdCommune'))
      if (previousCdCommune) expect(previousCdCommune >= CdCommune).toBe(true)
      previousCdCommune = CdCommune
    })
  })

  it('get nonexistent item', async () => {
    try {
      await request.get(`${baseUrl}/collections/hubeau-stations/items/xxx`)
      assert.fail('getting nonexistent item should raise on error')
    } catch (data) {
      const error = data.response.body
      expect(error).toBeDefined()
      expect(error.name).toBe('NotFound')
    }
  })

  it('get item', async () => {
    const response = await request.get(`${baseUrl}/collections/hubeau-stations/items/${feature._id}`)
    expect(response.body.id).toBeDefined()
    expect(response.body.id.toString()).toBe(feature._id.toString())
    expect(response.body.properties).toBeDefined()
    expect(response.body.links).toBeDefined()
    expect(response.body.links.length).toBe(2)
    response.body.links.forEach(link => {
      expect(link.href).toBeDefined()
      expect(link.rel).toBeDefined()
    })
  })

  it('get items with filtering on string property', async () => {
    const response = await request.get(`${baseUrl}/collections/hubeau-observations/items`)
      .query({ gml_id: 'StationHydro_FXX_shp.A282000101' })
    expect(response.body.features).toBeDefined()
    expect(response.body.numberMatched).toBeDefined()
    expect(response.body.numberReturned).toBeDefined()
    expect(response.body.numberMatched).toBe(nbObservations)
    expect(response.body.numberReturned).toBe(nbObservations < nbPerPage ? nbObservations : nbPerPage)
  })

  it('get items without filtering on a reserved query parameter', async () => {
    const response = await request.get(`${baseUrl}/collections/hubeau-stations/items`)
      .query({ jwt: 'xxx' })
    expect(response.body.features).toBeDefined()
    expect(response.body.numberMatched).toBeDefined()
    expect(response.body.numberReturned).toBeDefined()
    expect(response.body.numberMatched).toBe(nbStations)
    expect(response.body.numberReturned).toBe(nbStations < nbPerPage ? nbStations : nbPerPage)
  })

  it('get items with filtering on number property', async () => {
    const response = await request.get(`${baseUrl}/collections/hubeau-observations/items`)
      .query({ H: 0.63 })
    expect(response.body.features).toBeDefined()
    expect(response.body.numberMatched).toBeDefined()
    expect(response.body.numberReturned).toBeDefined()
    expect(response.body.numberMatched).toBe(1)
    expect(response.body.numberReturned).toBe(1)
  })

  it('get items with filtering on number-like property but stored as string', async () => {
    const response = await request.get(`${baseUrl}/collections/hubeau-stations/items`)
      .query({ CdCommune: '\'67520\'' })
    expect(response.body.features).toBeDefined()
    expect(response.body.numberMatched).toBeDefined()
    expect(response.body.numberReturned).toBeDefined()
    expect(response.body.numberMatched).toBe(1)
    expect(response.body.numberReturned).toBe(1)
  })

  it('get items with incomplete bbox', async () => {
    try {
      await request.get(`${baseUrl}/collections/hubeau-stations/items`)
        .query({ bbox: [6.39, 48.30, 48.32].join(',') })
      assert.fail('getting with incomplete bbox should raise on error')
    } catch (data) {
      const error = data.response.body
      expect(error).toBeDefined()
      expect(error.name).toBe('BadRequest')
    }
  })

  it('get items in bbox', async () => {
    const response = await request.get(`${baseUrl}/collections/hubeau-stations/items`)
      .query({ bbox: [6.39, 48.30, 6.41, 48.32].join(',') })
    expect(response.body.features).toBeDefined()
    expect(response.body.numberMatched).toBeDefined()
    expect(response.body.numberReturned).toBeDefined()
    expect(response.body.numberMatched).toBe(1)
    expect(response.body.numberReturned).toBe(1)
  })

  it('get items in bbox with CRS', async () => {
    const response = await request.get(`${baseUrl}/collections/hubeau-stations/items`)
      .query({
        bbox: [951316.244, 6805359.199, 952702.05, 6807643.879].join(','),
        'bbox-crs': 'http://www.opengis.net/def/crs/EPSG/2154'
      })
    expect(response.body.features).toBeDefined()
    expect(response.body.numberMatched).toBeDefined()
    expect(response.body.numberReturned).toBeDefined()
    expect(response.body.numberMatched).toBe(1)
    expect(response.body.numberReturned).toBe(1)
  })

  it('get paginated items', async () => {
    const nbPages = Math.ceil(nbStations / nbPerPage)
    const hasUnfilledPage = ((nbStations / nbPerPage) % 1 !== 0)
    let href = `${baseUrl}/collections/hubeau-stations/items?limit=${nbPerPage}`
    let previousFeatures
    // According to max limit allowed by service go through pages
    for (let i = 0; i < nbPages; i++) {
      const isLastPage = (i === (nbPages - 1))
      const response = await request.get(href)
      expect(response.body.features).toBeDefined()
      const currentFeatures = response.body.features
      if (i > 0) {
        // Check there is no doublon in pages
        previousFeatures.forEach(previousFeature => {
          expect(currentFeatures.find(currentFeature => {
            return previousFeature.properties.CdStationH === currentFeature.properties.CdStationH
          })).toBeUndefined()
        })
      }
      previousFeatures = currentFeatures
      expect(response.body.numberMatched).toBeDefined()
      expect(response.body.numberReturned).toBeDefined()
      expect(response.body.numberMatched).toBe(nbStations)
      expect(response.body.numberReturned).toBe(isLastPage && hasUnfilledPage ? nbStations - i * nbPerPage : nbPerPage)
      expect(response.body.links).toBeDefined()
      expect(response.body.links.length).toBe(isLastPage ? 1 : 2)
      const currentPage = response.body.links[0]
      expect(currentPage.href).toBeDefined()
      expect(currentPage.href.includes(`offset=${i * nbPerPage}`)).toBe(true)
      expect(currentPage.href.includes(`limit=${nbPerPage}`)).toBe(true)
      expect(currentPage.rel).toBeDefined()
      if (!isLastPage) {
        const nextPage = response.body.links[1]
        expect(nextPage.href).toBeDefined()
        expect(nextPage.href.includes(`offset=${(i + 1) * nbPerPage}`)).toBe(true)
        expect(nextPage.href.includes(`limit=${nbPerPage}`)).toBe(true)
        expect(nextPage.rel).toBeDefined()
        // Get next page url
        href = nextPage.href
      }
    }
  })

  it('get items at invalid time', async () => {
    try {
      await request.get(`${baseUrl}/collections/hubeau-observations/items`)
        .query({ datetime: 'xxx' })
      assert.fail('getting at invalid time should raise on error')
    } catch (data) {
      const error = data.response.body
      expect(error).toBeDefined()
      expect(error.name).toBe('BadRequest')
    }
  })

  it('get items at time', async () => {
    const response = await request.get(`${baseUrl}/collections/hubeau-observations/items`)
      .query({ datetime: '2018-10-22T22:00:00.000Z' })
    expect(response.body.features).toBeDefined()
    expect(response.body.numberMatched).toBeDefined()
    expect(response.body.numberReturned).toBeDefined()
    expect(response.body.numberMatched).toBe(1)
    expect(response.body.numberReturned).toBe(1)
  })

  it('get items with invalid time interval', async () => {
    try {
      await request.get(`${baseUrl}/collections/hubeau-observations/items`)
        .query({ datetime: '2018-10-22T22:00:00.000Z/2018-10-23T08:00:00.000Z/2018-10-24T08:00:00.000Z' })
      assert.fail('getting with invalid time interval should raise on error')
    } catch (data) {
      const error = data.response.body
      expect(error).toBeDefined()
      expect(error.name).toBe('BadRequest')
    }
  })

  it('get items in bounded time interval', async () => {
    // Data in range 2018-10-22T22:00:00.000Z/2018-10-24T08:00:00.000Z every hour
    const response = await request.get(`${baseUrl}/collections/hubeau-observations/items`)
      .query({ datetime: '2018-10-22T22:00:00.000Z/2018-10-24T08:00:00.000Z' })
    // First day = 3 obs, second day 24 obs, third day 8 obs
    const nbObservations = 3 + 24 + 8
    expect(response.body.features).toBeDefined()
    expect(response.body.numberMatched).toBeDefined()
    expect(response.body.numberReturned).toBeDefined()
    expect(response.body.numberMatched).toBe(nbObservations)
    expect(response.body.numberReturned).toBe(nbObservations < nbPerPage ? nbObservations : nbPerPage)
  })

  it('get items in half-bounded start time interval', async () => {
    // Data starts at 2018-10-22T22:00:00.000Z every hour
    const response = await request.get(`${baseUrl}/collections/hubeau-observations/items`)
      .query({ datetime: '../2018-10-23T08:00:00.000Z' })
    // First day = 3 obs, second day 8 obs
    const nbObservations = 3 + 8
    expect(response.body.features).toBeDefined()
    expect(response.body.numberMatched).toBeDefined()
    expect(response.body.numberReturned).toBeDefined()
    expect(response.body.numberMatched).toBe(nbObservations)
    expect(response.body.numberReturned).toBe(nbObservations < nbPerPage ? nbObservations : nbPerPage)
    // Data ends at 2018-11-23T08:06:00.000Z every 3 mns
    // First day = 3 obs, second day 8 obs
  })

  it('get items in half-bounded end time interval', async () => {
    // Data ends at 2018-11-23T08:06:00.000Z every 3 mns
    const response = await request.get(`${baseUrl}/collections/hubeau-observations/items`)
      .query({ datetime: '2018-11-22T20:00:00.000Z/..' })
    // First day = 80 obs, second day 163 obs
    const nbObservations = 80 + 163
    expect(response.body.features).toBeDefined()
    expect(response.body.numberMatched).toBeDefined()
    expect(response.body.numberReturned).toBeDefined()
    expect(response.body.numberMatched).toBe(nbObservations)
    expect(response.body.numberReturned).toBe(nbObservations < nbPerPage ? nbObservations : nbPerPage)
  })

  it('get items by sorted times', async () => {
    let time, previousTime, minTime, maxTime
    // Data starts at 2018-10-22T22:00:00.000Z every hour
    let response = await request.get(`${baseUrl}/collections/hubeau-observations/items`)
      .query({ datetime: '../2018-10-23T08:00:00.000Z' })
    let features = response.body.features
    expect(features).toBeDefined()
    expect(response.body.numberMatched).toBeDefined()
    expect(response.body.numberMatched > 0).toBe(true)
    // Default sort order should be descending time (only for features services)
    if (options.features) {
      minTime = moment.utc(features[features.length - 1].time)
      maxTime = moment.utc(features[0].time)
      expect(maxTime.isAfter(minTime)).toBe(true)
      features.forEach(feature => {
        time = moment.utc(feature.time)
        expect(time.isSameOrAfter(minTime)).toBe(true)
        expect(time.isSameOrBefore(maxTime)).toBe(true)
        if (previousTime) expect(time.isBefore(previousTime)).toBe(true)
        previousTime = time
      })
    }
    response = await request.get(`${baseUrl}/collections/hubeau-observations/items`)
      .query({ datetime: '../2018-10-23T08:00:00.000Z', sortby: '+time' })
    features = response.body.features
    expect(features).toBeDefined()
    expect(response.body.numberMatched).toBeDefined()
    expect(response.body.numberMatched > 0).toBe(true)
    // Sort order should now be ascending time
    if (options.features) {
      expect(moment.utc(features[0].time).isSame(minTime)).toBe(true)
      expect(moment.utc(features[features.length - 1].time).isSame(maxTime)).toBe(true)
    } else {
      minTime = moment.utc(features[0].time)
      maxTime = moment.utc(features[features.length - 1].time)
    }
    previousTime = undefined
    features.forEach(feature => {
      time = moment.utc(feature.time)
      expect(time.isSameOrAfter(minTime)).toBe(true)
      expect(time.isSameOrBefore(maxTime)).toBe(true)
      if (previousTime) expect(time.isAfter(previousTime)).toBe(true)
      previousTime = time
    })
  })

  it('get items with combined filters', async () => {
    // Data ends at 2018-11-23T08:06:00.000Z every 3 mns with some values higher than 0.33
    const response = await request.get(`${baseUrl}/collections/hubeau-observations/items`)
      .query({ H: 0.43, datetime: '2018-11-22T20:00:00.000Z/..', bbox: [7.42, 48.63, 7.43, 48.64].join(','), limit: 3 })
    expect(response.body.features).toBeDefined()
    expect(response.body.numberMatched).toBeDefined()
    expect(response.body.numberReturned).toBeDefined()
    expect(response.body.numberMatched).toBe(4)
    expect(response.body.numberReturned).toBe(3)
  })

  it('cql is null expressions', async () => {
    let response = await request.post(`${baseUrl}/collections/hubeau-observations/items`)
      .query({ 'filter-lang': 'cql-json', limit: 3 })
      .send({ op: 'isNull', args: [{ property: 'H' }] })
    expect(response.body.features).toBeDefined()
    expect(response.body.numberMatched).toBeDefined()
    expect(response.body.numberReturned).toBeDefined()
    expect(response.body.numberMatched).toBe(0)
    expect(response.body.numberReturned).toBe(0)
    response = await request.post(`${baseUrl}/collections/hubeau-observations/items`)
      .query({ 'filter-lang': 'cql-json', limit: 3 })
      .send({ op: 'not', args: [{ op: 'isNull', args: [{ property: 'H' }] }] })
    expect(response.body.features).toBeDefined()
    expect(response.body.numberMatched).toBeDefined()
    expect(response.body.numberReturned).toBeDefined()
    expect(response.body.numberMatched).toBe(nbObservations)
    expect(response.body.numberReturned).toBe(3)
  })

  it('cql comparison expressions', async () => {
    let response = await request.post(`${baseUrl}/collections/hubeau-observations/items`)
      .query({ 'filter-lang': 'cql-json', limit: 3 })
      .send({ op: 'eq', args: [{ property: 'H' }, 0.63] })
    expect(response.body.features).toBeDefined()
    expect(response.body.numberMatched).toBeDefined()
    expect(response.body.numberReturned).toBeDefined()
    expect(response.body.numberMatched).toBe(1)
    expect(response.body.numberReturned).toBe(1)

    response = await request.post(`${baseUrl}/collections/hubeau-observations/items`)
      .query({ 'filter-lang': 'cql-json', limit: 3 })
      .send({ op: 'lt', args: [{ property: 'H' }, 0.4] })
    expect(response.body.features).toBeDefined()
    expect(response.body.numberMatched).toBeDefined()
    expect(response.body.numberReturned).toBeDefined()
    expect(response.body.numberMatched).toBe(nbObservations - 9)
    expect(response.body.numberReturned).toBe(3)

    response = await request.get(`${baseUrl}/collections/hubeau-stations/items`)
      .query({ 'filter-lang': 'cql-text', filter: 'InfluLocal IS NULL', limit: 1 })
    expect(response.body.features).toBeDefined()
    expect(response.body.numberMatched).toBeDefined()
    expect(response.body.numberReturned).toBeDefined()
    expect(response.body.numberMatched).toBe(nbStationsWithNullInfluLocal)
    expect(response.body.numberReturned).toBe(1)
    expect(response.body.features[0].properties.InfluLocal).toBeNull()

    response = await request.get(`${baseUrl}/collections/hubeau-stations/items`)
      .query({ 'filter-lang': 'cql-text', filter: 'InfluLocal IS NOT NULL', limit: 1 })
    expect(response.body.features).toBeDefined()
    expect(response.body.numberMatched).toBeDefined()
    expect(response.body.numberReturned).toBeDefined()
    expect(response.body.numberMatched).toBe(nbStations - nbStationsWithNullInfluLocal)
    expect(response.body.numberReturned).toBe(1)
    expect(response.body.features[0].properties.InfluLocal).toBeDefined()
  })

  it('cql like expressions', async () => {
    // CQL JSON: case-sensitive exact match
    let response = await request.post(`${baseUrl}/collections/hubeau-stations/items`)
      .query({ 'filter-lang': 'cql-json', limit: 3 })
      .send({ op: 'like', args: [{ property: 'TypStation' }, 'LIMNI'] })
    expect(response.body.features).toBeDefined()
    expect(response.body.numberMatched).toBe(nbStationsLIMNI)
    response.body.features.forEach(f => expect(f.properties.TypStation).toBe('LIMNI'))

    // CQL JSON: case-insensitive via nocase (standard format)
    response = await request.post(`${baseUrl}/collections/hubeau-stations/items`)
      .query({ 'filter-lang': 'cql-json', limit: 3 })
      .send({ op: 'like', args: [{ property: 'TypStation' }, 'limni'], nocase: true })
    expect(response.body.numberMatched).toBe(nbStationsLIMNI)
    response.body.features.forEach(f => expect(f.properties.TypStation.toLowerCase()).toBe('limni'))

    // CQL JSON: wildcard pattern (contains)
    response = await request.post(`${baseUrl}/collections/hubeau-stations/items`)
      .query({ 'filter-lang': 'cql-json' })
      .send({ op: 'like', args: [{ property: 'LbStationH' }, '%Wasselonne%'] })
    expect(response.body.numberMatched).toBe(1)

    // CQL JSON: custom wildcard character
    response = await request.post(`${baseUrl}/collections/hubeau-stations/items`)
      .query({ 'filter-lang': 'cql-json' })
      .send({ op: 'like', args: [{ property: 'LbStationH' }, '*Wasselonne*'], wildcard: '*' })
    expect(response.body.numberMatched).toBe(1)

    // CQL JSON: NOT LIKE
    response = await request.post(`${baseUrl}/collections/hubeau-stations/items`)
      .query({ 'filter-lang': 'cql-json' })
      .send({ op: 'not', args: [{ op: 'like', args: [{ property: 'TypStation' }, 'LIMNI'] }] })
    expect(response.body.numberMatched).toBe(nbStations - nbStationsLIMNI)

    // CQL JSON: AND combining LIKE with another predicate
    response = await request.post(`${baseUrl}/collections/hubeau-stations/items`)
      .query({ 'filter-lang': 'cql-json' })
      .send({ op: 'and', args: [{ op: 'like', args: [{ property: 'TypStation' }, 'LIMNI'] }, { op: 'isNull', args: [{ property: 'InfluLocal' }] }] })
    expect(response.body.numberMatched).toBe(nbStationsLIMNIWithNullInfluLocal)

    // CQL text: LIKE exact match
    response = await request.get(`${baseUrl}/collections/hubeau-stations/items`)
      .query({ 'filter-lang': 'cql-text', filter: 'TypStation LIKE \'LIMNI\'', limit: 3 })
    expect(response.body.numberMatched).toBe(nbStationsLIMNI)

    // CQL text: ILIKE exact match
    response = await request.get(`${baseUrl}/collections/hubeau-stations/items`)
      .query({ 'filter-lang': 'cql-text', filter: 'TypStation ILIKE \'limni\'', limit: 3 })
    expect(response.body.numberMatched).toBe(nbStationsLIMNI)

    // CQL text: LIKE with % wildcard (contains)
    response = await request.get(`${baseUrl}/collections/hubeau-stations/items`)
      .query({ 'filter-lang': 'cql-text', filter: 'LbStationH LIKE \'%Wasselonne%\'' })
    expect(response.body.numberMatched).toBe(1)

    // CQL text: ILIKE with % wildcard (case-insensitive contains)
    response = await request.get(`${baseUrl}/collections/hubeau-stations/items`)
      .query({ 'filter-lang': 'cql-text', filter: 'LbStationH ILIKE \'%wasselonne%\'' })
    expect(response.body.numberMatched).toBe(1)

    // CQL text: LIKE with % wildcard (starts with, includes space in pattern)
    response = await request.get(`${baseUrl}/collections/hubeau-stations/items`)
      .query({ 'filter-lang': 'cql-text', filter: 'LbStationH LIKE \'La %\'' })
    expect(response.body.numberMatched).toBe(270)

    // CQL text: LIKE with % wildcard (ends with)
    response = await request.get(`${baseUrl}/collections/hubeau-stations/items`)
      .query({ 'filter-lang': 'cql-text', filter: 'LbStationH LIKE \'%Wasselonne\'' })
    expect(response.body.numberMatched).toBe(1)

    // CQL text: LIKE with _ wildcard (single char)
    response = await request.get(`${baseUrl}/collections/hubeau-stations/items`)
      .query({ 'filter-lang': 'cql-text', filter: 'TypStation LIKE \'LIM_I\'', limit: 3 })
    expect(response.body.numberMatched).toBe(nbStationsLIMNI)

    // CQL text: LIKE with partially URL-encoded filter (% not encoded as %25, quotes encoded as %27)
    // This simulates clients that encode ' → %27 but leave % as raw, causing qs to fall back
    // and leave %27 undecoded; our normalization in convertCqlQuery must fix this
    response = await request.get(
      `${baseUrl}/collections/hubeau-stations/items?filter-lang=cql-text&filter=LbStationH%20LIKE%20%27%25Wasselonne%25%27`)
    expect(response.body.numberMatched).toBe(1)
    response = await request.get(
      `${baseUrl}/collections/hubeau-stations/items?filter-lang=cql-text&filter=LbStationH%20LIKE%20%27%Wasselonne%25%27`)
    expect(response.body.numberMatched).toBe(1)
  })

  it('cql logical expressions', async () => {
    let response = await request.post(`${baseUrl}/collections/hubeau-observations/items`)
      .query({ 'filter-lang': 'cql-json', limit: 3 })
      .send({ op: 'and', args: [{ op: 'gte', args: [{ property: 'H' }, 0.63] }, { op: 'lte', args: [{ property: 'H' }, 0.63] }] })
    expect(response.body.features).toBeDefined()
    expect(response.body.numberMatched).toBeDefined()
    expect(response.body.numberReturned).toBeDefined()
    expect(response.body.numberMatched).toBe(1)
    expect(response.body.numberReturned).toBe(1)
    response = await request.post(`${baseUrl}/collections/hubeau-observations/items`)
      .query({ 'filter-lang': 'cql-json', limit: 3 })
      .send({ op: 'not', args: [{ op: 'lt', args: [{ property: 'H' }, 0.63] }] })
    expect(response.body.features).toBeDefined()
    expect(response.body.numberMatched).toBeDefined()
    expect(response.body.numberReturned).toBeDefined()
    expect(response.body.numberMatched).toBe(1)
    expect(response.body.numberReturned).toBe(1)
  })

  it('cql temporal expressions', async () => {
    // Data in range 2018-10-22T22:00:00.000Z/2018-10-24T08:00:00.000Z every hour
    const response = await request.post(`${baseUrl}/collections/hubeau-observations/items`)
      .query({ 'filter-lang': 'cql-json' })
      .send({ op: 't_during', args: [{ property: 'time' }, ['2018-10-22T22:00:00.000Z', '2018-10-24T08:00:00.000Z']] })
    // First day = 3 obs, second day 24 obs, third day 8 obs
    const nbObservations = 3 + 24 + 8
    expect(response.body.features).toBeDefined()
    expect(response.body.numberMatched).toBeDefined()
    expect(response.body.numberReturned).toBeDefined()
    expect(response.body.numberMatched).toBe(nbObservations)
    expect(response.body.numberReturned).toBe(nbObservations < nbPerPage ? nbObservations : nbPerPage)
  })

  it('cql spatial expressions', async () => {
    let response = await request.post(`${baseUrl}/collections/hubeau-stations/items`)
      .query({ 'filter-lang': 'cql-json', limit: 3 })
      .send({ op: 's_intersects', args: [{ property: 'geometry' }, { type: 'Polygon', coordinates: [[[7.42, 48.63], [7.43, 48.63], [7.43, 48.64], [7.42, 48.64], [7.42, 48.63]]] }] })
    expect(response.body.features).toBeDefined()
    expect(response.body.numberMatched).toBeDefined()
    expect(response.body.numberReturned).toBeDefined()
    expect(response.body.numberMatched).toBe(1)
    expect(response.body.numberReturned).toBe(1)

    response = await request.get(`${baseUrl}/collections/hubeau-stations/items`)
      .query({ 'filter-lang': 'cql-text', filter: 'S_INTERSECTS(geometry,POLYGON((7.42 48.63, 7.43 48.63, 7.43 48.64, 7.42 48.64, 7.42 48.63)))', limit: 3 })
    expect(response.body.features).toBeDefined()
    expect(response.body.numberMatched).toBeDefined()
    expect(response.body.numberReturned).toBeDefined()
    expect(response.body.numberMatched).toBe(1)
    expect(response.body.numberReturned).toBe(1)

    // CQL text: intersects with URL-encoded WKT
    response = await request.get(
      `${baseUrl}/collections/hubeau-stations/items?filter-lang=cql-text&filter=S_INTERSECTS(geometry,POLYGON((7.42%2048.63,%207.43%2048.63,%207.43%2048.64,%207.42%2048.64,%207.42%2048.63)))`)
    expect(response.body.features).toBeDefined()
    expect(response.body.numberMatched).toBeDefined()
    expect(response.body.numberReturned).toBeDefined()
    expect(response.body.numberMatched).toBe(1)
    expect(response.body.numberReturned).toBe(1)
  })

  // Cleanup
  afterAll(async () => {
    if (server) await server.close()
    finalize(kapp)
    fs.emptyDirSync(path.join(__dirname, 'logs'))
    if (options.catalog) await catalogService.Model.drop()
    await hubeauStationsService.Model.drop()
    await hubeauObsService.Model.drop()
    await kapp.db.disconnect()
  })
}
describe('kfs', () => {
  it('is ES module compatible', () => {
    expect(typeof createServer).toBe('function')
  })

  // Run test with/without catalog
  // and with/without features services
  runTests({
    catalog: false,
    features: true
  })/*
  runTests({
    catalog: true,
    features: true
  })
  // Expose specific non-features service
  config.services = (serviceName, service) => {
    if (serviceName.includes('hubeau')) return {
      properties: true,
      query: { geoJson: true }
    }
  }
  runTests({
    catalog: false,
    features: false
  }) */
})
