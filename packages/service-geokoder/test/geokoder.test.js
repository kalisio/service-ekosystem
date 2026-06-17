import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import _ from 'lodash'
import { describe, it, afterAll, expect } from 'vitest'
import { createServer } from '../src/server.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

describe('geokoder:geokoder', () => {
  let server, app
  let remoteServer, remoteApp

  const result = {
    streetName: 'Chemin des Tournesols', city: 'Castelnaudary', country: 'France'
  }

  const searches = [
    { pattern: '80 Chemin des tournesols, 11400 Castelnaudary', sources: 'remote:opendatafrance', results: [result] },
    { pattern: '80 Chemin des tournesols, 11400 Castelnaudary', sources: 'remote:open*', results: [result, result] },
    { pattern: '80 Chemin des tournesols, 11400 Castelnaudary', sources: 'remote:opendatafrance', viewbox: '1.891365,43.283502,2.010069,43.340896', results: [result] },
    { pattern: '80 Chemin des tournesols, 11400 Castelnaudary', sources: 'remote:opendatafrance', viewbox: '-2.915497,45.691553,-2.440681,45.911512', results: [] }
  ]

  const locations = [
    { lat: 45.15493, lon: 3.20801, sources: 'remote:opendatafrance', results: [] },
    { lat: 43.29961, lon: 1.93729, sources: 'remote:openstreetmap', results: [result] },
    { lat: 43.29961, lon: 1.93729, sources: 'remote:open*', results: [result, result] }
  ]

  it('is ES module compatible', () => {
    expect(typeof createServer).toBe('function')
  })

  it('initialize the services', async () => {
    remoteServer = await createServer({ port: 8450, apiUrl: 'http://localhost:8450/api' })
    remoteApp = remoteServer.app
    expect(remoteApp).toBeDefined()
    server = await createServer({
      port: 8451,
      apiUrl: 'http://localhost:8451/api',
      distribution: {},
      providers: {
        Geokoder: {
          remote: {
            url: 'http://localhost:8450/api'
          }
        }
      }
    })
    app = server.app
    expect(app).toBeDefined()
  }, 15000)

  it('geokoder proxy sources appear in capabilities', async () => {
    const apiUrl = app.get('apiUrl')

    let response = await fetch(`${apiUrl}/capabilities/forward`)
    let body = await response.json()
    expect(body.geocoders).toBeDefined()
    expect(body.geocoders.includes('remote:openstreetmap')).toBe(true)
    expect(body.geocoders.includes('remote:opendatafrance')).toBe(true)

    response = await fetch(`${apiUrl}/capabilities/reverse`)
    body = await response.json()
    expect(body.geocoders).toBeDefined()
    expect(body.geocoders.includes('remote:openstreetmap')).toBe(true)
    expect(body.geocoders.includes('remote:opendatafrance')).toBe(true)
  }, 10000)

  it('forward geocoding through geokoder proxy', async () => {
    const apiUrl = app.get('apiUrl')
    for (const search of searches) {
      const params = [`q=${search.pattern}`, `sources=${search.sources}`, 'limit=2']
      if (search.viewbox) params.push(`viewbox=${search.viewbox}`)
      const response = await fetch(`${apiUrl}/forward?${params.join('&')}`)
      const body = await response.json()
      expect(body.length).toBe(search.results.length)
      body.forEach((feature, index) => {
        expect(_.pick(feature.properties, Object.keys(search.results[index]))).toEqual(search.results[index])
        expect(feature.geokoder.source).toMatch(/^remote:/)
      })
    }
  }, 30000)

  it('reverse geocoding through geokoder proxy', async () => {
    const apiUrl = app.get('apiUrl')
    for (const location of locations) {
      const response = await fetch(`${apiUrl}/reverse?lat=${location.lat}&lon=${location.lon}&limit=2&sources=${location.sources}`)
      const body = await response.json()
      expect(body.length).toBe(location.results.length)
      body.forEach((feature, index) => {
        expect(_.pick(feature.properties, Object.keys(location.results[index]))).toEqual(location.results[index])
        expect(feature.geokoder.source).toMatch(/^remote:/)
      })
    }
  }, 30000)

  afterAll(async () => {
    await app?.teardown()
    await remoteApp?.teardown()
    const logsDir = path.join(__dirname, 'logs')
    for (const file of fs.readdirSync(logsDir)) {
      fs.rmSync(path.join(logsDir, file), { recursive: true, force: true })
    }
  })
})
