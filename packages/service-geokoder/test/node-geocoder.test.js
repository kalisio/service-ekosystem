import _ from 'lodash'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { describe, it, afterAll, expect } from 'vitest'
import { createServer } from '../src/server.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

describe('geokoder:node-geocoder', () => {
  let server, app

  const result = {
    streetName: 'Chemin des Tournesols', city: 'Castelnaudary', country: 'France'
  }
  const searches = [
    { pattern: 'Chemin des poireaux, 1100 Castelnaudary', sources: 'openstreetmap', results: [] },
    { pattern: '80 Chemin des tournesols, 11400 Castelnaudary', sources: 'opendatafrance', results: [result] },
    { pattern: '80 Chemin des tournesols, 11400 Castelnaudary', sources: 'open*', results: [result, result] },
    { pattern: '80 Chemin des tournesols, 11400 Castelnaudary', sources: 'opendatafrance', viewbox: '1.891365,43.283502,2.010069,43.340896', results: [result] },
    { pattern: '80 Chemin des tournesols, 11400 Castelnaudary', sources: 'opendatafrance', viewbox: '-2.915497,45.691553,-2.440681,45.911512', results: [] }
  ]
  const locations = [
    { lat: 45.15493, lon: 3.20801, sources: 'opendatafrance', results: [] },
    { lat: 43.29961, lon: 1.93729, sources: 'openstreetmap', results: [result] },
    { lat: 43.29961, lon: 1.93729, sources: 'open*', results: [result, result] }
  ]

  it('is ES module compatible', () => {
    expect(typeof createServer).toBe('function')
  })

  it('initialize the service', async () => {
    server = await createServer()
    expect(server).toBeDefined()
    app = server.app
    expect(app).toBeDefined()
  }, 10000)

  it('node geocoder sources appear in capabilities', async () => {
    const apiUrl = app.get('apiUrl')
    let response = await fetch(`${apiUrl}/capabilities/forward`)
    let body = await response.json()
    expect(body.geocoders).toBeDefined()
    expect(body.geocoders.includes('openstreetmap')).toBe(true)
    expect(body.geocoders.includes('opendatafrance')).toBe(true)

    response = await fetch(`${apiUrl}/capabilities/reverse`)
    body = await response.json()
    expect(body.geocoders).toBeDefined()
    expect(body.geocoders.includes('openstreetmap')).toBe(true)
    expect(body.geocoders.includes('opendatafrance')).toBe(true)
  }, 10000)

  it('forward geocoding on node geocoder sources', async () => {
    const apiUrl = app.get('apiUrl')
    for (const search of searches) {
      const params = [`q=${search.pattern}`, `sources=${search.sources}`, 'limit=2']
      if (search.viewbox) params.push(`viewbox=${search.viewbox}`)
      const response = await fetch(`${apiUrl}/forward?${params.join('&')}`)
      const body = await response.json()
      expect(body.length).toBe(search.results.length)
      body.forEach((feature, index) => {
        const result = search.results[index]
        expect(_.pick(feature.properties, Object.keys(result))).toEqual(result)
      })
    }
  }, 10000)

  it('reverse geocoding on node geocoder sources', async () => {
    const apiUrl = app.get('apiUrl')
    for (const location of locations) {
      const response = await fetch(`${apiUrl}/reverse?lat=${location.lat}&lon=${location.lon}&limit=2&sources=${location.sources}`)
      const body = await response.json()
      expect(body.length).toBe(location.results.length)
      body.forEach((feature, index) => {
        const result = location.results[index]
        expect(_.pick(feature.properties, Object.keys(result))).toEqual(result)
      })
    }
  }, 10000)

  afterAll(async () => {
    await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()))
    const logsDir = path.join(__dirname, 'logs')
    for (const file of fs.readdirSync(logsDir)) {
      fs.rmSync(path.join(logsDir, file), { recursive: true, force: true })
    }
  })
})
