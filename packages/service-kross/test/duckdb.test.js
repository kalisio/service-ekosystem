import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeAll, afterAll, describe, it, expect } from 'vitest'
import { DuckDBInstance } from '@duckdb/node-api'
import { createServer } from '../src/server.js'

// Two 2x2 squares side by side: A covers [0,2]x[0,2], B covers [2,4]x[0,2]
async function createDataset (filepath) {
  const instance = await DuckDBInstance.create(':memory:')
  const connection = await instance.connect()
  await connection.run('INSTALL spatial; LOAD spatial;')
  await connection.run(`
    CREATE TABLE squares AS
    SELECT * FROM (VALUES
      ('A', 1, ST_GeomFromText('POLYGON((0 0, 2 0, 2 2, 0 2, 0 0))')),
      ('B', 2, ST_GeomFromText('POLYGON((2 0, 4 0, 4 2, 2 2, 2 0))'))
    ) AS t(name, value, geometry)`)
  await connection.run(`
    COPY squares TO '${filepath}' (FORMAT parquet)`)
  connection.closeSync()
  instance.closeSync()
}

const polygon = (minX, minY, maxX, maxY) => ({
  type: 'Polygon',
  coordinates: [[[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY], [minX, minY]]]
})

describe('kross:duckdb', () => {
  let server, baseUrl, dataDir

  async function intersect (body) {
    return fetch(`${baseUrl}/intersect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
  }

  beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kross-'))
    const url = path.join(dataDir, 'squares.parquet')
    await createDataset(url)
    server = await createServer({
      port: 8460,
      providers: {
        DuckDB: {
          datasets: {
            squares: { url },
            'squares-names': { url, properties: ['name'] }
          }
        }
      }
    })
    baseUrl = `http://localhost:8460${server.app.get('apiPath')}`
  })

  afterAll(async () => {
    await server.app.teardown()
    server.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('lists sources', async () => {
    const response = await fetch(`${baseUrl}/capabilities/intersect`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ sources: ['squares', 'squares-names'] })
  })

  it('rejects unknown operations', async () => {
    const response = await fetch(`${baseUrl}/capabilities/union`)
    expect(response.status).toBe(400)
  })

  it('rejects invalid geometries', async () => {
    expect((await intersect({})).status).toBe(400)
    expect((await intersect({ geometry: { type: 'Polygon' } })).status).toBe(400)
    expect((await intersect({ geometry: polygon(0, 0, 1, 1), limit: -1 })).status).toBe(400)
  })

  it('intersects a geometry', async () => {
    const response = await intersect({ geometry: polygon(0.5, 0.5, 1, 1), sources: 'squares' })
    expect(response.status).toBe(200)
    const collection = await response.json()
    expect(collection.type).toBe('FeatureCollection')
    expect(collection.features).toHaveLength(1)
    const [feature] = collection.features
    expect(feature.properties).toEqual({ name: 'A', value: 1 })
    expect(feature.geometry.type).toBe('Polygon')
    expect(feature.kross).toEqual({ source: 'squares' })
  })

  it('intersects a feature across sources', async () => {
    const response = await intersect({ geometry: { type: 'Feature', properties: {}, geometry: polygon(1, 1, 3, 1.5) } })
    const collection = await response.json()
    // 2 squares x 2 sources
    expect(collection.features).toHaveLength(4)
    const namedFeatures = collection.features.filter(feature => feature.kross.source === 'squares-names')
    expect(namedFeatures.map(feature => feature.properties)).toEqual(expect.arrayContaining([{ name: 'A' }, { name: 'B' }]))
  })

  it('clips geometries', async () => {
    const collection = await (await intersect({ geometry: polygon(1, 1, 3, 3), sources: 'squares', clip: true })).json()
    expect(collection.features).toHaveLength(2)
    collection.features.forEach(feature => {
      // Each clipped part is a 1x1 square
      const xs = feature.geometry.coordinates[0].map(([x]) => x)
      expect(Math.max(...xs) - Math.min(...xs)).toBe(1)
    })
  })

  it('limits results', async () => {
    const collection = await (await intersect({ geometry: polygon(1, 1, 3, 1.5), limit: 1 })).json()
    expect(collection.features).toHaveLength(1)
  })

  it('returns nothing without matching source', async () => {
    const collection = await (await intersect({ geometry: polygon(1, 1, 3, 1.5), sources: 'unknown' })).json()
    expect(collection.features).toHaveLength(0)
  })
})
