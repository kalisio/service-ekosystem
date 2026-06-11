import _ from 'lodash'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { describe, it, afterAll, expect } from 'vitest'
import { createServer } from '../src/server.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

describe('geokoder:mbtiles', () => {
  let server, app

  const locations = [
    { lat: 43.31091, lon: 1.94750, distance: 0, sources: 'mairies:mairies', results: [] },
    { lat: 43.31091, lon: 1.94750, distance: 1000, sources: 'mairies:mairies', results: ['Castelnaudary'] },
    { lat: 43.31091, lon: 1.94750, distance: 0, sources: 'epci:epci50m', results: ['CC Castelnaudary Lauragais Audois'] },
    { lat: 43.21375, lon: 2.34725, distance: 0, sources: 'carcassonne:commune', results: ['Carcassonne'] }
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

  it('mbtiles sources appear in capabilities', async () => {
    const apiUrl = app.get('apiUrl')
    let response = await fetch(`${apiUrl}/capabilities/forward`)
    let body = await response.json()
    expect(body.geocoders).toBeDefined()
    expect(body.geocoders.includes('mairies:mairies')).toBe(false)
    expect(body.geocoders.includes('epci:epci50m')).toBe(false)
    expect(body.geocoders.includes('carcassonne:commune')).toBe(false)

    response = await fetch(`${apiUrl}/capabilities/reverse`)
    body = await response.json()
    expect(body.geocoders).toBeDefined()
    expect(body.geocoders.includes('mairies:mairies')).toBe(true)
    expect(body.geocoders.includes('epci:epci50m')).toBe(true)
    expect(body.geocoders.includes('carcassonne:commune')).toBe(true)
  }, 10000)

  it('reverse geocoding on mbtiles sources', async () => {
    const apiUrl = app.get('apiUrl')
    for (const location of locations) {
      const response = await fetch(`${apiUrl}/reverse?lat=${location.lat}&lon=${location.lon}&distance=${location.distance}&sources=${location.sources}`)
      const body = await response.json()
      console.log(body)
      expect(body.length).toBe(location.results.length)
      body.forEach((feature, index) => {
        const name = _.get(feature, 'properties.nom', _.get(feature, 'properties.NOM', ''))
        expect(name).toBe(location.results[index])
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
