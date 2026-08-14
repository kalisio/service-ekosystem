import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { describe, it, afterAll, expect } from 'vitest'
import _ from 'lodash'
import distribution from '@kalisio/feathers-distributed'
import { createApplication } from '@kalisio/kdk-core-api'
import { createFeaturesService, createCatalogService, removeCatalogService } from '@kalisio/kdk-map-api'
import { createServer } from '../src/server.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

describe('geokoder:kano', () => {
  let server, app, kapp, catalogService, defaultLayers, telerayStationsService, rteUnitsService

  const searches = [
    { pattern: 'xxx', sources: 'kano:teleray-stations', results: [] },
    { pattern: 'aye', sources: 'kano:teleray-stations', results: ['BLAYE'] },
    { pattern: 'chin', sources: 'kano:*', results: ['CHINON', 'Chinon-B1', 'Chinon-B2'] },
    { pattern: 'chin', sources: 'kano:*', viewbox: '0.119305,47.110446,0.356712,47.217705', results: ['CHINON'] },
    { pattern: 'chin', sources: 'kano:*', viewbox: '-2.915497,45.691553,-2.440681,45.911512', results: [] }
  ]

  const locations = [
    { lat: 47.16, lon: 0.24, distance: 0, sources: 'kano:teleray-stations', results: [] },
    { lat: 47.16, lon: 0.24, distance: 1000, sources: 'kano:teleray-stations', results: ['CHINON'] },
    { lat: 47.16, lon: 0.24, distance: 10000, sources: 'kano:rte-units', results: ['Chinon-B1', 'Chinon-B2'] }
  ]

  it('is ES module compatible', () => {
    expect(typeof createServer).toBe('function')
  })

  it('initialize the remote app', async () => {
    kapp = createApplication()
    await kapp.configure(distribution({
      cote: {
        helloInterval: 2000,
        checkInterval: 4000,
        nodeTimeout: 5000,
        masterTimeout: 6000
      },
      publicationDelay: 3000,
      key: 'geokoder-test',
      services: (service) => service.path.includes('teleray') ||
                             service.path.includes('rte') ||
                             service.path.includes('catalog')
    }))
    await kapp.db.connect()
    await createCatalogService.call(kapp)
    catalogService = kapp.getService('catalog')
    expect(catalogService).toBeDefined()
  }, 5000)

  it('registers the kano layers', async () => {
    const layers = JSON.parse(await fs.promises.readFile(path.join(__dirname, 'config/layers.json'), 'utf8'))
    expect(layers.length).toBeGreaterThan(0)
    defaultLayers = await catalogService.create(layers)
    if (!Array.isArray(defaultLayers)) defaultLayers = [defaultLayers]
    expect(defaultLayers.length).toBeGreaterThan(0)
  })

  it('create and feed the kano services', async () => {
    await createFeaturesService.call(kapp, {
      collection: 'teleray-stations',
      featureId: 'irsnId',
      featureLabel: 'name'
    })
    await createFeaturesService.call(kapp, {
      collection: 'rte-units',
      featureId: 'eicCode',
      featureLabel: 'name'
    })
    telerayStationsService = kapp.getService('teleray-stations')
    expect(telerayStationsService).toBeDefined()
    rteUnitsService = kapp.getService('rte-units')
    expect(rteUnitsService).toBeDefined()
    let stations = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/teleray.stations.json'), 'utf8')).features
    await telerayStationsService.create(stations)
    stations = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/rte.units.json'), 'utf8')).features
    await rteUnitsService.create(stations)
  }, 5000)

  it('initialize the geokoder service', async () => {
    server = await createServer({ port: 8452, baseUrl: 'http://localhost:8452/api' })
    expect(server).toBeDefined()
    app = server.app
    expect(app).toBeDefined()
    await new Promise(resolve => setTimeout(resolve, 10000))
  }, 15000)

  it('only allowed kano sources from catalog appear in capabilities', async () => {
    const baseUrl = app.get('baseUrl')
    let response = await fetch(`${baseUrl}/capabilities/forward`)
    let body = await response.json()
    expect(body.geocoders).toBeDefined()
    expect(body.geocoders.includes('kano:teleray-stations')).toBe(true)
    expect(body.geocoders.includes('kano:rte-units')).toBe(true)
    expect(body.geocoders.includes('kano:filtered-units')).toBe(false)

    response = await fetch(`${baseUrl}/capabilities/reverse`)
    body = await response.json()
    expect(body.geocoders).toBeDefined()
    expect(body.geocoders.includes('kano:teleray-stations')).toBe(true)
    expect(body.geocoders.includes('kano:rte-units')).toBe(true)
    expect(body.geocoders.includes('kano:filtered-units')).toBe(false)
  }, 10000)

  it('kano provider should not expose duplicate sources', async () => {
    const baseUrl = app.get('baseUrl')
    let response = await fetch(`${baseUrl}/capabilities/forward`)
    let body = await response.json()
    expect(body.geocoders).toBeDefined()
    let seen = new Set()
    body.geocoders.forEach((src) => {
      if (!src.startsWith('kano:')) return
      expect(seen.has(src)).toBe(false)
      seen.add(src)
    })

    response = await fetch(`${baseUrl}/capabilities/reverse`)
    body = await response.json()
    expect(body.geocoders).toBeDefined()
    seen = new Set()
    body.geocoders.forEach((src) => {
      if (!src.startsWith('kano:')) return
      expect(seen.has(src)).toBe(false)
      seen.add(src)
    })
  }, 10000)

  it('forward geocoding on kano sources from catalog', async () => {
    const baseUrl = app.get('baseUrl')
    for (const search of searches) {
      const params = [`q=${search.pattern}`, `sources=${search.sources}`]
      if (search.viewbox) params.push(`viewbox=${search.viewbox}`)
      const response = await fetch(`${baseUrl}/forward?${params.join('&')}`)
      const body = await response.json()
      expect(body.length).toBe(search.results.length)
      body.forEach((feature, index) => {
        expect(_.get(feature, 'properties.name', '')).toBe(search.results[index])
      })
    }
  }, 10000)

  it('reverse geocoding on kano sources from catalog', async () => {
    const baseUrl = app.get('baseUrl')
    for (const location of locations) {
      const response = await fetch(`${baseUrl}/reverse?lat=${location.lat}&lon=${location.lon}&distance=${location.distance}&sources=${location.sources}`)
      const body = await response.json()
      expect(body.length).toBe(location.results.length)
      body.forEach((feature, index) => {
        expect(_.get(feature, 'properties.name', '')).toBe(location.results[index])
      })
    }
  }, 10000)

  it('kano sources from services appear in capabilities', async () => {
    await catalogService.Model.drop()
    await removeCatalogService.call(kapp)
    catalogService = kapp.getService('catalog')
    expect(catalogService).toBeNull()

    const baseUrl = app.get('baseUrl')
    let response = await fetch(`${baseUrl}/capabilities/forward`)
    let body = await response.json()
    expect(body.geocoders).toBeDefined()
    expect(body.geocoders.includes('services:teleray-stations')).toBe(true)
    expect(body.geocoders.includes('services:rte-units')).toBe(true)

    response = await fetch(`${baseUrl}/capabilities/reverse`)
    body = await response.json()
    expect(body.geocoders).toBeDefined()
    expect(body.geocoders.includes('services:teleray-stations')).toBe(true)
    expect(body.geocoders.includes('services:rte-units')).toBe(true)
  }, 10000)

  it('forward geocoding on kano sources from services', async () => {
    const baseUrl = app.get('baseUrl')
    for (const search of searches) {
      const params = [`q=${search.pattern}`, `sources=${search.sources.replace('kano', 'services')}`]
      if (search.viewbox) params.push(`viewbox=${search.viewbox}`)
      const response = await fetch(`${baseUrl}/forward?${params.join('&')}`)
      const body = await response.json()
      expect(body.length).toBe(search.results.length)
      body.forEach((feature, index) => {
        expect(_.get(feature, 'properties.name', '')).toBe(search.results[index])
      })
    }
  }, 10000)

  it('reverse geocoding on kano sources from services', async () => {
    const baseUrl = app.get('baseUrl')
    for (const location of locations) {
      const response = await fetch(`${baseUrl}/reverse?lat=${location.lat}&lon=${location.lon}&distance=${location.distance}&sources=${location.sources.replace('kano', 'services')}`)
      const body = await response.json()
      expect(body.length).toBe(location.results.length)
      body.forEach((feature, index) => {
        expect(_.get(feature, 'properties.name', '')).toBe(location.results[index])
      })
    }
  }, 10000)

  afterAll(async () => {
    await app.teardown()
    const logsDir = path.join(__dirname, 'logs')
    for (const file of fs.readdirSync(logsDir)) {
      fs.rmSync(path.join(logsDir, file), { recursive: true, force: true })
    }
    await telerayStationsService.Model.drop()
    await rteUnitsService.Model.drop()
    await kapp.db.disconnect()
  })
})
