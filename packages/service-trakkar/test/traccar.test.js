import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import http from 'http'
import { WebSocketServer } from 'ws'

let app, connectWebSocket, httpServer, wss, base
const trackingStore = []

beforeAll(async () => {
  // 1. HTTP endpoints (session/devices/positions) + a WebSocket at /api/socket
  httpServer = http.createServer((req, res) => {
    if (req.url.startsWith('/api/session')) {
      res.setHeader('Set-Cookie', 'JSESSIONID=testsession; Path=/; HttpOnly')
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ id: 1, name: 'tester' }))
    } else if (req.url.startsWith('/api/devices') || req.url.startsWith('/api/positions')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('[]')
    } else {
      res.writeHead(404)
      res.end()
    }
  })
  wss = new WebSocketServer({ server: httpServer, path: '/api/socket' })
  // When traccar.js connects, stream it a device followed by its position
  wss.on('connection', (socket) => {
    socket.send(JSON.stringify({ devices: [{ id: 5, name: 'car', attributes: {} }] }))
    socket.send(JSON.stringify({
      positions: [{
        id: 9,
        deviceId: 5,
        latitude: 44.3,
        longitude: 4.7,
        serverTime: new Date().toISOString(),
        attributes: {}
      }]
    }))
  })
  // Bind to a random free port (0), then read the one the OS assigned
  await new Promise(resolve => httpServer.listen(0, resolve))
  base = `http://localhost:${httpServer.address().port}`

  // 2. Config the service reads at boot, pointing it at our fake Traccar
  process.env.TRACCAR_EMAIL = 'tester@example.com'
  process.env.TRACCAR_PASSWORD = 'secret'
  process.env.TRACCAR_URL = base

  // traccar.js calls process.exit(1) when the socket closes (prod restart behaviour);
  // stub it so tearing down the fake server can't kill the test runner.
  vi.spyOn(process, 'exit').mockImplementation(() => undefined)

  // 3. Launch the real service (this boots index.js) and give it fast timings
  ;({ default: app } = await import('../src/index.js'))
  app.set('traccar_url', base)
  app.set('update_interval', 10)

  // 4. Real in-memory Maps services on the running app
  app.use('api/tracking', {
    async find ({ query }) {
      if (query && query.$distinct) return [] // list of device ids
      return { features: [...trackingStore], total: trackingStore.length }
    },
    async create (data) { trackingStore.push(data); return data },
    async patch () { return [] }
  })
  app.use('api/catalog', {
    async find () { return { total: 1, data: [{ name: 'Layers.TRACCAR', ttl: 3600 }] } }
  })

  // 5. Run the real WebSocket pipeline
  ;({ default: connectWebSocket } = await import('../src/traccar.js'))
  await connectWebSocket()
})

afterAll(async () => {
  if (wss) {
    for (const client of wss.clients) client.terminate() // drop the live socket
    wss.close()
  }
  // Let traccar's ws 'close' handler fire (it calls the stubbed process.exit) before we finish.
  // We intentionally never restore the process.exit stub: traccar.js exits the process on socket
  // close (prod restart behaviour), which would otherwise kill the vitest worker during teardown.
  await new Promise(resolve => setTimeout(resolve, 100))
  if (httpServer) {
    httpServer.closeAllConnections?.() // release any lingering connections so close() resolves
    await new Promise(resolve => httpServer.close(resolve))
  }
})

describe('traccar service (end-to-end)', () => {
  it('connects, receives a position over the WebSocket, and saves a feature to Maps', async () => {
    // Wait for the throttled pipeline to flush the feature into api/tracking
    await vi.waitFor(() => {
      expect(trackingStore.length).toBeGreaterThan(0)
    }, { timeout: 5000, interval: 50 })

    const feature = trackingStore[0]
    expect(feature.type).toBe('Feature')
    expect(feature.properties.deviceId).toBe(5)
    expect(feature.geometry).toEqual({ type: 'Point', coordinates: [4.7, 44.3] })
    expect(feature.subLayer).toBe('KALISIO_TEAM')
  })
})
