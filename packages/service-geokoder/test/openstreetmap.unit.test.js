import { describe, it, expect } from 'vitest'
import { createOpenStreetMapProvider } from '../src/providers/openstreetmap.js'
import { createApp, fixture, mockFetch, requestedUrl, viewbox } from './helpers.js'

function createProvider (options = {}) {
  return createOpenStreetMapProvider(createApp({ OpenStreetMap: options }))
}

describe('geokoder:openstreetmap', () => {
  it('is not created when disabled', async () => {
    expect(await createOpenStreetMapProvider(createApp({ OpenDataFrance: true }))).toBeNull()
  })

  it('exposes a single source', async () => {
    const provider = await createOpenStreetMapProvider(createApp({ NodeGeocoder: { openstreetmap: true } }))
    expect(provider.name).toBe('OpenStreetMap')
    expect(provider.capabilities({ operation: 'forward' })).toEqual(['openstreetmap'])
    expect(provider.capabilities({ operation: 'reverse' })).toEqual(['openstreetmap'])
  })

  it('forward geocodes an address', async () => {
    const fetch = mockFetch(fixture('osm-search'))
    const provider = await createProvider({ fetch, language: 'fr', email: 'contact@kalisio.com' })
    const results = await provider.forward({ search: '80 Chemin des tournesols, 11400 Castelnaudary', filter: '*', limit: 2, viewbox })
    const url = requestedUrl(fetch)
    expect(url.origin + url.pathname).toBe('https://nominatim.openstreetmap.org/search')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: '80 Chemin des tournesols, 11400 Castelnaudary',
      limit: '2',
      viewbox: '1.891365,43.283502,2.010069,43.340896',
      bounded: '1',
      format: 'json',
      addressdetails: '1',
      'accept-language': 'fr',
      email: 'contact@kalisio.com'
    })
    expect(fetch.mock.calls[0][1].headers['user-agent']).toMatch(/^geokoder\/\d+\.\d+\.\d+/)
    expect(results).toEqual([{
      source: 'openstreetmap',
      feature: {
        type: 'Feature',
        properties: {
          formattedAddress: '80, Chemin des Tournesols, Castelnaudary, Carcassonne, Aude, Occitanie, France métropolitaine, 11400, France',
          country: 'France',
          city: 'Castelnaudary',
          state: 'Occitanie',
          zipcode: '11400',
          streetName: 'Chemin des Tournesols',
          streetNumber: '80',
          countryCode: 'FR',
          neighbourhood: ''
        },
        geometry: { type: 'Point', coordinates: [1.9372955, 43.2996036] }
      },
      matchProp: 'formattedAddress',
      match: '80, Chemin des Tournesols, Castelnaudary, Carcassonne, Aude, Occitanie, France métropolitaine, 11400, France'
    }])
  })

  it('falls back on alternative address fields', async () => {
    const provider = await createProvider({
      fetch: mockFetch([
        { lat: '1', lon: '2', display_name: 'A', address: { town: 'Town', cycleway: 'Cycleway', neighbourhood: 'Quartier' } },
        { lat: '1', lon: '2', address: { village: 'Village' } },
        { lat: '1', lon: '2', address: { hamlet: 'Hamlet', city: undefined } },
        { display_name: 'No address' }
      ])
    })
    const results = await provider.forward({ search: 'x', filter: '*', limit: 4 })
    expect(results[0].feature.properties).toMatchObject({ city: 'Town', streetName: 'Cycleway', neighbourhood: 'Quartier' })
    expect(results[0].feature.properties.countryCode).toBeUndefined()
    expect(results[1].feature.properties.city).toBe('Village')
    expect(results[1].match).toBe('')
    expect(results[2].feature.properties.city).toBe('Hamlet')
    expect(results[3].feature.properties).toMatchObject({ formattedAddress: 'No address', neighbourhood: '' })
    expect(results[3].feature.geometry.coordinates).toEqual([undefined, undefined])
  })

  it('reverse geocodes a location', async () => {
    const fetch = mockFetch(fixture('osm-reverse'))
    const provider = await createProvider({ fetch, osmServer: 'https://nominatim.local' })
    const results = await provider.reverse({ lat: 43.29961, lon: 1.93729, filter: '*', limit: 2 })
    const url = requestedUrl(fetch)
    expect(url.origin + url.pathname).toBe('https://nominatim.local/reverse')
    expect(Object.fromEntries(url.searchParams)).toEqual({ lat: '43.29961', lon: '1.93729', format: 'json', addressdetails: '1' })
    expect(results.length).toBe(1)
    expect(results[0].source).toBe('openstreetmap')
    expect(results[0].feature.properties.formattedLabel).toBe(results[0].feature.properties.formattedAddress)
  })

  it('prefers the url option over osmServer', async () => {
    const fetch = mockFetch([])
    const provider = await createProvider({ fetch, url: 'https://a.local', osmServer: 'https://b.local' })
    await provider.forward({ search: 'x', filter: '*' })
    expect(requestedUrl(fetch).origin).toBe('https://a.local')
  })

  it('returns no result when nothing is found by a reverse query', async () => {
    const provider = await createProvider({ fetch: mockFetch(fixture('osm-reverse-empty')) })
    expect(await provider.reverse({ lat: 0, lon: -30, filter: '*' })).toEqual([])
  })

  it('returns no result when the service fails', async () => {
    const provider = await createProvider({ fetch: mockFetch({ error: { code: 400, message: 'Bad request' } }, 400) })
    expect(await provider.forward({ search: 'x'.repeat(300), filter: '*' })).toEqual([])
  })

  it('does not query the service when its source is filtered out', async () => {
    const fetch = mockFetch(fixture('osm-search'))
    const provider = await createProvider({ fetch })
    expect(await provider.forward({ search: 'Castelnaudary', filter: 'opendatafrance' })).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  })
})
