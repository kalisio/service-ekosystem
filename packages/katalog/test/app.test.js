import { describe, it, beforeAll, afterAll, expect } from 'vitest'
import { createServer } from '../src/server.js'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let server
let app
let appUrl

describe('Katalog application tests', () => {
  beforeAll(async () => {
    server = createServer()
    app = server.app
    app.set('port', 0)

    await server.run()

    // Fallback to 3030 if server.address() is unavailable for some reason
    const addr = app.server ? app.server.address() : null
    const port = addr ? addr.port : 3030
    appUrl = `http://${app.get('host') || 'localhost'}:${port}`
  }, 60000)

  afterAll(async () => {
    await app.teardown()
  })

  it('shows a 404 JSON error for unknown routes', async () => {
    const response = await fetch(`${appUrl}/path/to/nowhere`)
    const error = await response.json()

    expect(response.status).toBe(404)
    expect(error.name).toBe('NotFound')
  })

  it('can directly list layer files in the config directory', async () => {
    const layersDir = path.resolve(__dirname, '../config/layers')
    const files = await fs.readdir(layersDir, { recursive: true, withFileTypes: true })

    const layerFiles = files.filter(f => f.isFile() && f.name.endsWith('.cjs')).map(f => f.name)

    expect(layerFiles.length).toBeGreaterThan(10)
    expect(layerFiles.includes('adminexpress-layers.cjs')).toBe(true)
    expect(layerFiles.includes('awc-layers.cjs')).toBe(true)
  })

  it('populates the catalog service with layer files on startup', async () => {
    const catalogService = app.getService('catalog')

    const layers = await catalogService.find({ query: {}, paginate: false })
    const layerArray = Array.isArray(layers) ? layers : layers.data

    expect(layerArray.length).toBeGreaterThan(0)

    const hasAdminLayer = layerArray.some(layer => layer.tags && layer.tags.includes('administrative'))
    expect(hasAdminLayer).toBe(true)
  })
})
