import { describe, it, expect, vi } from 'vitest'
import { fetchJson, getGeocoderOptions, querySource } from '../src/utils.js'
import { createApp, mockFetch } from './helpers.js'

describe('geokoder:utils', () => {
  describe('fetchJson', () => {
    it('drops nil parameters from the query string', async () => {
      const fetch = mockFetch({})
      await fetchJson('https://geocoder.org/search', { params: { q: 'a b', limit: undefined, lat: null, lon: 0 }, fetch })
      expect(fetch.mock.calls[0][0]).toBe('https://geocoder.org/search?q=a+b&lon=0')
    })

    it('does not add an empty query string', async () => {
      const fetch = mockFetch({})
      await fetchJson('https://geocoder.org/search', { fetch })
      expect(fetch.mock.calls[0][0]).toBe('https://geocoder.org/search')
      expect(fetch.mock.calls[0][1].signal).toBeUndefined()
    })

    it('rejects on HTTP errors', async () => {
      const fetch = mockFetch({ message: 'Bad request' }, 400)
      await expect(fetchJson('https://geocoder.org/search', { fetch })).rejects.toThrow('failed with status 400')
    })

    it('aborts requests exceeding the timeout', async () => {
      const fetch = vi.fn((url, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason))
      }))
      await expect(fetchJson('https://geocoder.org/search', { fetch, timeout: 10 })).rejects.toThrow()
    })
  })

  describe('getGeocoderOptions', () => {
    const provider = { provider: 'OpenStreetMap', source: 'openstreetmap' }

    it('returns null when the provider is not configured or disabled', () => {
      for (const providers of [{}, { OpenStreetMap: false }, { NodeGeocoder: { openstreetmap: false } }, { NodeGeocoder: { opendatafrance: true } }]) {
        const app = createApp(providers)
        expect(getGeocoderOptions(app, provider)).toBeNull()
        expect(app.logger.warn).not.toHaveBeenCalled()
      }
    })

    it('applies default options', () => {
      const options = getGeocoderOptions(createApp({ OpenStreetMap: true }), provider)
      expect(options.userAgent).toMatch(/^geokoder\/\d+\.\d+\.\d+/)
      expect(options.timeout).toBe(10000)
    })

    it('lets the configuration override default options', () => {
      const options = getGeocoderOptions(createApp({ OpenStreetMap: { timeout: 500, language: 'fr' } }), provider)
      expect(options).toMatchObject({ timeout: 500, language: 'fr' })
    })

    it('supports the deprecated NodeGeocoder configuration', () => {
      const app = createApp({ NodeGeocoder: { openstreetmap: { language: 'fr' } } })
      expect(getGeocoderOptions(app, provider)).toMatchObject({ language: 'fr' })
      expect(app.logger.warn).toHaveBeenCalledWith(expect.stringContaining('deprecated'))
    })

    it('ignores the deprecated NodeGeocoder configuration when the provider one is defined', () => {
      const app = createApp({ OpenStreetMap: false, NodeGeocoder: { openstreetmap: true } })
      expect(getGeocoderOptions(app, provider)).toBeNull()
      expect(app.logger.warn).toHaveBeenCalledWith(expect.stringContaining('ignored'))
    })
  })

  describe('querySource', () => {
    it('tags results with the source', async () => {
      const results = await querySource('osm', '*', async () => [{ feature: {} }], vi.fn())
      expect(results).toEqual([{ source: 'osm', feature: {} }])
    })

    it('does not run the request when the source is filtered out', async () => {
      const request = vi.fn()
      expect(await querySource('osm', 'kano:*', request, vi.fn())).toEqual([])
      expect(request).not.toHaveBeenCalled()
    })

    it('ignores failed requests', async () => {
      const debug = vi.fn()
      expect(await querySource('osm', undefined, async () => { throw new Error('Unable to geocode') }, debug)).toEqual([])
      expect(debug).toHaveBeenCalledWith('Request to osm failed:', expect.any(Error))
    })
  })
})
