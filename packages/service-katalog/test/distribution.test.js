import { describe, it, beforeAll, afterAll, expect, vi } from 'vitest'
import { feathers } from '@feathersjs/feathers'
import express from '@feathersjs/express'
import distribution, { finalize } from '@kalisio/feathers-distributed'
import { createServer } from '../src/server.js'

let server
let consumer

describe('Distribution tests', () => {
  beforeAll(async () => {
    server = createServer()
    server.app.set('port', 0)
    await server.run()

    consumer = feathers()
    consumer.configure(distribution({
      key: 'kalisio',
      services: () => false,
      remoteServices: (service) => service.key === 'katalog',
      middlewares: { after: express.errorHandler() }
    }))
  }, 60000)

  afterAll(async () => {
    if (consumer) await finalize(consumer)
    if (server) await server.app.teardown()
  })

  it('discovers the catalog service remotely', { timeout: 35000 }, async () => {
    const catalog = await vi.waitFor(
      () => consumer.service('api/catalog'),
      { timeout: 30000, interval: 500 }
    )
    expect(catalog).toBeDefined()
  })

  // Layers are stored in MongoDB — total reflects the real DB count
  describe('Layers', () => {
    it('returns OverlayLayers', async () => {
      const res = await consumer.service('api/catalog').find({ query: { type: 'OverlayLayer' } })
      expect(Array.isArray(res.data)).toBe(true)
      expect(res.total).toBeGreaterThan(0)
    })

    it('returns BaseLayers', async () => {
      const res = await consumer.service('api/catalog').find({ query: { type: 'BaseLayer' } })
      expect(Array.isArray(res.data)).toBe(true)
      expect(res.total).toBeGreaterThan(0)
    })

    it('returns TerrainLayers', async () => {
      const res = await consumer.service('api/catalog').find({ query: { type: 'TerrainLayer' } })
      expect(Array.isArray(res.data)).toBe(true)
      expect(res.total).toBeGreaterThan(0)
    })

    it('excludes Category and Sublegend from default find', async () => {
      const res = await consumer.service('api/catalog').find({ query: {} })
      expect(Array.isArray(res.data)).toBe(true)
      const hasCategory = res.data.some(item => item.type === 'Category')
      const hasSublegend = res.data.some(item => item.type === 'Sublegend')
      expect(hasCategory).toBe(false)
      expect(hasSublegend).toBe(false)
    })

    it('can filter layers by tags', async () => {
      const res = await consumer.service('api/catalog').find({ query: { type: 'OverlayLayer', tags: { $in: ['administrative'] } } })
      expect(Array.isArray(res.data)).toBe(true)
      expect(res.total).toBeGreaterThan(0)
      expect(res.data.every(layer => layer.tags.includes('administrative'))).toBe(true)
    })
  })

  // Categories come from config files, injected by the getDefaultCategories hook
  // They are NOT stored in MongoDB so total stays 0 — only data.length reflects them
  describe('Categories', () => {
    it('returns categories when queried by type', async () => {
      const res = await consumer.service('api/catalog').find({ query: { type: 'Category' } })
      expect(Array.isArray(res.data)).toBe(true)
      expect(res.data.length).toBeGreaterThan(0)
      expect(res.data.every(item => item.type === 'Category')).toBe(true)
    })

    it('every category has a name and icon', async () => {
      const res = await consumer.service('api/catalog').find({ query: { type: 'Category' } })
      expect(res.data.every(cat => cat.name && cat.icon)).toBe(true)
    })
  })

  // Sublegends come from config files, injected by the getDefaultSublegends hook
  describe('Sublegends', () => {
    it('returns sublegends when queried by type', async () => {
      const res = await consumer.service('api/catalog').find({ query: { type: 'Sublegend' } })
      expect(Array.isArray(res.data)).toBe(true)
      expect(res.data.length).toBeGreaterThan(0)
      expect(res.data.every(item => item.type === 'Sublegend')).toBe(true)
    })
  })

  // CRUD operates on the underlying MongoDB documents (layers)
  describe('CRUD via distribution', () => {
    let createdId

    beforeAll(async () => {
      const doc = await consumer.service('api/catalog').create({ name: 'test-layer', type: 'OverlayLayer' })
      createdId = doc._id.toString()
    })

    afterAll(async () => {
      if (createdId) {
        await consumer.service('api/catalog').remove(createdId).catch(() => {})
      }
    })

    it('creates a document', () => {
      expect(createdId).toBeDefined()
    })

    it('gets the document by id', async () => {
      const doc = await consumer.service('api/catalog').get(createdId)
      expect(doc._id.toString()).toBe(createdId)
      expect(doc.name).toBe('test-layer')
    })

    it('patches the document', async () => {
      const doc = await consumer.service('api/catalog').patch(createdId, { name: 'test-layer-patched' })
      expect(doc.name).toBe('test-layer-patched')
    })

    it('removes the document', async () => {
      const doc = await consumer.service('api/catalog').remove(createdId)
      expect(doc._id.toString()).toBe(createdId)
      await expect(consumer.service('api/catalog').get(createdId)).rejects.toThrow()
      createdId = null
    })
  })

  // Key filtering — a consumer with the wrong key must not discover katalog services
  it('does not expose services to consumers with a different key', { timeout: 10000 }, async () => {
    const wrongConsumer = feathers()
    wrongConsumer.configure(distribution({
      key: 'other-key',
      services: () => false,
      remoteServices: (service) => service.key === 'other-key',
      middlewares: { after: express.errorHandler() }
    }))

    await new Promise(resolve => setTimeout(resolve, 5000))
    expect(() => wrongConsumer.service('catalog')).toThrow()
    await finalize(wrongConsumer)
  })
})
