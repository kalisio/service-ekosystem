import { describe, it, beforeAll, afterAll, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pixelmatch from 'pixelmatch'
import png from 'pngjs'
import { createServer } from '../src/main.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const url = (process.env.KAPTURE_URL
  ? process.env.KAPTURE_URL
  : (process.env.PORT ? `http://localhost:${process.env.PORT}` : 'http://localhost:3000'))
const jwt = process.env.KAPTURE_JWT

const dataDir = path.join(__dirname, 'data/capture')
const runDir = path.join(__dirname, 'run/capture')

const suite = 'capture'

async function capture (parameters, image) {
  const urlOptions = {
    method: 'POST',
    body: JSON.stringify(parameters),
    headers: {
      'Content-Type': 'application/json'
    }
  }
  if (jwt) urlOptions.headers.Authorization = 'Bearer ' + jwt
  const res = await fetch(`${url}/capture`, urlOptions)
  if (res.status === 200) {
    const arrayBuffer = await res.arrayBuffer()
    const buffer = new Uint8Array(arrayBuffer)
    fs.writeFileSync(path.join(runDir, image + '.png'), buffer)
  }
  return res
}

function match (image) {
  const runKey = path.join(runDir, image + '.png')
  const refKey = path.join(__dirname, 'data', suite, 'screenrefs', image + '.png')
  const runImg = png.PNG.sync.read(fs.readFileSync(runKey))
  const refImg = png.PNG.sync.read(fs.readFileSync(refKey))
  const { width, height } = runImg
  const diff = new png.PNG({ width, height })
  const options = {
    alpha: 0.3,
    diffColor: [255, 0, 0],
    diffColorAlt: [0, 255, 0],
    threshold: 0.1
  }
  const numDiffs = pixelmatch(runImg.data, refImg.data, diff.data, width, height, options)
  const diffRatio = 100.0 * (numDiffs / (width * height))
  if (diffRatio < 5.0) return true
  console.error(`<!> image diff ratio for ${image}:`, diffRatio)
  return false
}

describe(`suite:${suite}`, () => {
  let server

  beforeAll(async () => {
    if (!fs.existsSync(runDir)) {
      fs.mkdirSync(runDir, { recursive: true })
    }
    server = await createServer()
    expect(server).toBeDefined()
  }, 15000)

  it('handle invalid JSON body', async () => {
    const body = JSON.parse(fs.readFileSync(path.join(dataDir, 'invalid.geojson')))
    const res = await capture(body, 'invalid')
    expect(res.status).toBe(422)
    const resMessage = await res.json()
    expect(resMessage.message).toBe('Invalid "GeoJSON"')
    expect(resMessage.errors.length).toBe(1)
  })

  it('handle invalid width body', async () => {
    const body = {
      size: {
        width: 5001
      }
    }
    const res = await capture(body, 'invalid')
    expect(res.status).toBe(404)
    const resMessage = await res.json()
    expect(resMessage.message === 'Invdalid "width" property')
  }, 25000)

  it('capture default map view', async () => {
    const body = {}
    const res = await capture(body, 'default-view')
    expect(res.status).toBe(200)
    expect(match('default-view')).toBe(true)
  }, 25000)

  it('capture multiple zoomed layers', async () => {
    const body = {
      layers: ['Layers.IMAGERY', 'Layers.ADMINEXPRESS'],
      bbox: [1.30, 45.51, 5.93, 47.88]
    }
    const res = await capture(body, 'map-layers')
    expect(res.status).toBe(200)
    expect(match('map-layers')).toBe(true)
  }, 120000)

  it('handle invalid geojson crs', async () => {
    const body = JSON.parse(fs.readFileSync(path.join(dataDir, 'shapes-L93.geojson')))
    const res = await capture(body, 'map-shapes')
    expect(res.status).toBe(422)
    const resMessage = await res.json()
    expect(resMessage.message === 'Invdalid "GeoJSON"')
    expect(resMessage.errors.length).toBe(1)
    expect(resMessage.errors.message === 'Invalid CRS: urn:ogc:def:crs:epsg::2154')
  }, 15000)

  it('capture heterogenous geojson file', async () => {
    const body = JSON.parse(fs.readFileSync(path.join(dataDir, 'shapes-WGS84.geojson')))
    const res = await capture(body, 'map-shapes')
    expect(res.status).toBe(200)
    expect(match('map-shapes')).toBe(true)
  }, 120000)

  it('capture heterogenous kml file', async () => {
    const body = {
      type: 'kml',
      content: fs.readFileSync(path.join(dataDir, 'shapes-WGS84.kml'), 'utf-8')
    }
    const res = await capture(body, 'kml-map-shapes')
    expect(res.status).toBe(200)
    expect(match('kml-map-shapes')).toBe(true)
  }, 120000)

  it('capture heterogenous kml file base64 encoded', async () => {
    const body = {
      type: 'kml',
      encoding: 'base64',
      content: Buffer.from(fs.readFileSync(path.join(dataDir, 'shapes-WGS84.kml'), 'utf-8')).toString('base64')
    }
    const res = await capture(body, 'kml-map-shapes')
    expect(res.status).toBe(200)
    expect(match('kml-map-shapes')).toBe(true)
  }, 120000)

  it('handle too large geojson file', async () => {
    const body = JSON.parse(fs.readFileSync(path.join(dataDir, 'adsb.geojson')))
    const res = await capture(body, 'adsb')
    expect(res.status).toBe(413)
  }, 25000)

  it('capture gradient geojson file', async () => {
    const body = JSON.parse(fs.readFileSync(path.join(dataDir, 'flight.geojson')))
    body.layers = ['Layers.OSM_DARK']
    body.size = { width: 800, height: 600 }
    const res = await capture(body, 'gradient-layer')
    expect(res.status).toBe(200)
    expect(match('gradient-layer')).toBe(true)
  }, 25000)

  it('capture geojson with defined bbox', async () => {
    const body = JSON.parse(fs.readFileSync(path.join(dataDir, 'flight.geojson')))
    body.layers = ['Layers.OSM_DARK']
    body.size = { width: 800, height: 600 }
    body.bbox = [3.5, 51, 5.5, 53]
    const res = await capture(body, 'bounded-layer')
    expect(res.status).toBe(200)
    expect(match('bounded-layer')).toBe(true)
  }, 25000)

  // it('capture mask geojson file', async () => {
  //   const body = JSON.parse(fs.readFileSync(path.join(dataDir, 'occitanie.geojson')))
  //   body.layers = ['Layers.HYBRID']
  //   body.size = { width: 1200, height: 900 }
  //   const res = await capture(body, 'mask-layer')
  //   expect(res.status).toBe(200)
  //   expect(match('mask-layer')).toBe(true)
  // })

  it('capture with default locale', async () => {
    const body = {}
    body.layout = JSON.parse(fs.readFileSync(path.join(dataDir, 'layout.json')))
    body.layers = ['Layers.OSM_BRIGHT', 'Layers.VIGICRUES']
    body.bbox = [0.2636, 46.32, 4.8834, 47.9844]
    body.size = { width: 2048, height: 1080 }
    body.delay = 4000
    const res = await capture(body, 'default-locale')
    expect(res.status).toBe(200)
    expect(match('default-locale')).toBe(true)
  }, 25000)

  it('capture with french locale', async () => {
    const body = { lang: 'fr-FR' }
    body.layout = JSON.parse(fs.readFileSync(path.join(dataDir, 'layout.json')))
    body.layers = ['Layers.OSM_BRIGHT', 'Layers.VIGICRUES']
    body.bbox = [0.2636, 46.32, 4.8834, 47.9844]
    body.size = { width: 2048, height: 1080 }
    body.delay = 4000
    const res = await capture(body, 'french-locale')
    expect(res.status).toBe(200)
    expect(match('french-locale')).toBe(true)
  }, 25000)

  afterAll(async () => {
    if (server) await server.close()
  })
})
