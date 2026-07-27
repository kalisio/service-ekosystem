import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import http from 'http'

let app, base, httpServer
let generateFeature, getSessionHeaders, saveLastInfosFromTraccar, manualFetchData, updateDevicesLayers

// Mutable state driving the fake Traccar responses and the in-memory tracking store
let traccar
let trackingStore
let patchCalls

beforeAll(async () => {
  // 1.A real HTTP server whose responses each test can tune via `traccar`
  httpServer = http.createServer((req, res) => {
    if (req.url.startsWith('/api/session')) {
      if (traccar.sessionCookie) res.setHeader('Set-Cookie', traccar.sessionCookie)
      res.writeHead(traccar.sessionStatus, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ id: 1 }))
    } else if (req.url.startsWith('/api/devices')) {
      res.writeHead(traccar.dataStatus, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(traccar.devices))
    } else if (req.url.startsWith('/api/positions')) {
      res.writeHead(traccar.dataStatus, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(traccar.positions))
    } else {
      res.writeHead(404)
      res.end()
    }
  })
  await new Promise(resolve => httpServer.listen(0, resolve))
  base = `http://localhost:${httpServer.address().port}`

  // 2. Boot the REAL service, on a random port, pointing at the Traccar.
  //    PORT=0 avoids colliding with the service booted by traccar.test.js.
  process.env.TRACCAR_EMAIL = 'tester@example.com'
  process.env.TRACCAR_PASSWORD = 'secret'
  process.env.TRACCAR_URL = base
  process.env.PORT = '0'
  ;({ default: app } = await import('../src/index.js'))
  app.set('traccar_url', base)

  // 3. A real in-memory api/tracking service on the running app.
  //    (We do NOT register api/features, so the boot loop never auto-connects the WebSocket.)
  app.use('api/tracking', {
    async find ({ query }) {
      if (query.$distinct) {
        return [...new Set(trackingStore.map(f => f.properties.deviceId))]
      }
      const deviceId = query['properties.deviceId']
      const matched = trackingStore.filter(f => f.properties.deviceId === deviceId)
      return { features: matched.slice(0, query.$limit ?? matched.length) }
    },
    async patch (id, data, { query }) {
      const deviceId = query['properties.deviceId']
      const updated = trackingStore.filter(f => f.properties.deviceId === deviceId)
      updated.forEach(feature => { feature.subLayer = data.subLayer })
      patchCalls.push({ deviceId, subLayer: data.subLayer })
      return updated
    }
  })

  // 4. Import the real helpers (they use the real app we just booted)
  ;({ generateFeature, getSessionHeaders, saveLastInfosFromTraccar, manualFetchData, updateDevicesLayers } =
    await import('../src/helper.js'))
})

afterAll(async () => {
  if (httpServer) {
    httpServer.closeAllConnections?.()
    await new Promise(resolve => httpServer.close(resolve))
  }
})

beforeEach(() => {
  app.set('filters', [{ query: {}, subLayer: 'KALISIO_TEAM' }])
  app.processWSQueue = []
  trackingStore = []
  patchCalls = []
  traccar = {
    sessionStatus: 200,
    sessionCookie: 'JSESSIONID=abc123; Path=/; HttpOnly',
    dataStatus: 200,
    devices: [],
    positions: []
  }
})

describe('generateFeature', () => {
  it('builds a GeoJSON Feature from a device and its position', () => {
    const currentDevice = {
      devices: { id: 5, name: 'car', attributes: { color: 'red' } },
      positions: { id: 9, deviceId: 5, latitude: 44.3, longitude: 4.7, speed: 10, serverTime: '2024-01-01T00:00:00Z', attributes: { distance: 3 } }
    }
    const feature = generateFeature(currentDevice)
    expect(feature.type).toBe('Feature')
    expect(feature.subLayer).toBe('KALISIO_TEAM')
    expect(feature.geometry).toEqual({ type: 'Point', coordinates: [4.7, 44.3] })
    expect(feature.properties.deviceId).toBe(5)
    expect(feature.properties.positionId).toBe(9)
    expect(feature.properties.color).toBe('red') // nested `attributes` were unwound to the root
    expect(feature.time).toBe('2024-01-01T00:00:00Z')
    expect(feature._id).toMatch(/^[a-f0-9]{32}$/) // md5 hex digest
  })

  it('returns null when the device or position is missing', () => {
    expect(generateFeature({ devices: null, positions: {} })).toBeNull()
    expect(generateFeature({})).toBeNull()
  })

  it('returns nothing when no filter matches the data', () => {
    app.set('filters', [{ query: { deviceId: 99999 }, subLayer: 'NOPE' }])
    const currentDevice = {
      devices: { id: 5 },
      positions: { id: 9, deviceId: 5, latitude: 1, longitude: 2 }
    }
    expect(generateFeature(currentDevice)).toBeUndefined()
  })
})

describe('getSessionHeaders', () => {
  it('extracts the JSESSIONID cookie into a Cookie header', async () => {
    const headers = await getSessionHeaders()
    expect(headers).toEqual({ Cookie: 'JSESSIONID=abc123' })
  })

  it('throws when the response is not ok', async () => {
    traccar.sessionStatus = 401
    await expect(getSessionHeaders()).rejects.toThrow(/401/)
  })

  it('throws when no JSESSIONID cookie is returned', async () => {
    traccar.sessionCookie = null
    await expect(getSessionHeaders()).rejects.toThrow(/JSESSIONID not found/)
  })
})

describe('saveLastInfosFromTraccar', () => {
  it('pushes each device together with its matching position', async () => {
    traccar.devices = [{ id: 5 }, { id: 6 }]
    traccar.positions = [{ deviceId: 5, latitude: 1, longitude: 2 }]
    await saveLastInfosFromTraccar()
    // device 5 has a position (device + position pushed = 2 entries); device 6 has none (skipped)
    expect(app.processWSQueue).toHaveLength(2)
  })

  it('throws when Traccar returns a non-200 status', async () => {
    traccar.dataStatus = 500
    await expect(saveLastInfosFromTraccar()).rejects.toThrow(/Error getting data/)
  })
})

describe('manualFetchData', () => {
  it('pushes the fetched device and position onto the queue', async () => {
    traccar.devices = [{ id: 5, name: 'car' }]
    traccar.positions = [{ id: 9, deviceId: 5, latitude: 1, longitude: 2 }]
    await manualFetchData(5)
    expect(app.processWSQueue).toHaveLength(2)
    expect(app.processWSQueue[0]).toHaveProperty('devices')
    expect(app.processWSQueue[1]).toHaveProperty('positions')
  })

  it('skips (pushes nothing) when the device is not found', async () => {
    traccar.devices = []
    traccar.positions = []
    await manualFetchData(5)
    expect(app.processWSQueue).toHaveLength(0)
  })
})

describe('updateDevicesLayers', () => {
  it('re-layers a device whose filter result changed', async () => {
    trackingStore = [{ properties: { deviceId: 5 }, subLayer: 'OLD_LAYER', time: '2024-01-01T00:00:00Z' }]
    await updateDevicesLayers()
    // the filter yields KALISIO_TEAM, which differs from OLD_LAYER, so the feature is patched
    expect(patchCalls).toHaveLength(1)
    expect(trackingStore[0].subLayer).toBe('KALISIO_TEAM')
  })

  it('does not patch when the layer is unchanged', async () => {
    trackingStore = [{ properties: { deviceId: 5 }, subLayer: 'KALISIO_TEAM', time: '2024-01-01T00:00:00Z' }]
    await updateDevicesLayers()
    expect(patchCalls).toHaveLength(0)
  })
})
