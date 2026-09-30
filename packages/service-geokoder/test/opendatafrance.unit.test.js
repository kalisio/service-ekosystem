import { describe, it, expect } from 'vitest'
import { createOpenDataFranceProvider } from '../src/providers/opendatafrance.js'
import { createApp, fixture, mockFetch, requestedUrl, viewbox } from './helpers.js'

function createProvider (options = {}) {
  return createOpenDataFranceProvider(createApp({ OpenDataFrance: options }))
}

describe('geokoder:opendatafrance', () => {
  it('is not created when disabled', async () => {
    expect(await createOpenDataFranceProvider(createApp({ OpenDataFrance: false }))).toBeNull()
  })

  it('exposes a single source', async () => {
    const provider = await createOpenDataFranceProvider(createApp({ NodeGeocoder: { opendatafrance: true } }))
    expect(provider.name).toBe('OpenDataFrance')
    expect(provider.capabilities({ operation: 'forward' })).toEqual(['opendatafrance'])
    expect(provider.capabilities({ operation: 'reverse' })).toEqual(['opendatafrance'])
  })

  it('forward geocodes an address', async () => {
    const fetch = mockFetch(fixture('ban-search'))
    const provider = await createProvider({ fetch, userAgent: 'geokoder/test' })
    const results = await provider.forward({ search: '80 Chemin des tournesols, 11400 Castelnaudary', filter: '*', limit: 2 })
    const url = requestedUrl(fetch)
    expect(url.origin + url.pathname).toBe('https://data.geopf.fr/geocodage/search')
    expect(Object.fromEntries(url.searchParams)).toEqual({ q: '80 Chemin des tournesols, 11400 Castelnaudary', limit: '2' })
    expect(fetch.mock.calls[0][1].headers['user-agent']).toBe('geokoder/test')
    expect(fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
    expect(results).toEqual([{
      source: 'opendatafrance',
      feature: {
        type: 'Feature',
        properties: {
          state: '11, Aude, Occitanie',
          city: 'Castelnaudary',
          zipcode: '11400',
          citycode: '11076',
          countryCode: 'FR',
          country: 'France',
          type: 'housenumber',
          id: '11076_2942_00080',
          streetName: 'Chemin des Tournesols',
          streetNumber: '80'
        },
        geometry: { type: 'Point', coordinates: [1.93729, 43.299612] }
      },
      matchProp: 'streetName',
      match: 'Chemin des Tournesols'
    }])
  })

  it('forward geocodes municipalities and streets', async () => {
    const provider = await createProvider({ fetch: mockFetch(fixture('ban-search-city')) })
    const [municipality, street] = await provider.forward({ search: 'Castelnaudary', filter: '*' })
    expect(municipality.matchProp).toBe('city')
    expect(municipality.match).toBe('Castelnaudary')
    expect(municipality.feature.properties.population).toBe(12151)
    expect(municipality.feature.properties.streetName).toBeUndefined()
    expect(street.matchProp).toBe('streetName')
    expect(street.match).toBe('Rue de Castelnaudary')
  })

  it('maps every result type', async () => {
    const result = (properties) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] }, properties })
    const provider = await createProvider({
      fetch: mockFetch({
        features: [
          result({ type: 'locality', name: 'Le Bourg', city: 'Ville' }),
          result({ type: 'street', name: 'Rue Haute', city: 'Ville' }),
          result({ type: 'unknown', city: 'Ville' }),
          result({ type: 'unknown' })
        ]
      })
    })
    const results = await provider.forward({ search: 'Ville', filter: '*' })
    expect(results.map(({ matchProp, match }) => [matchProp, match])).toEqual([
      ['streetName', 'Le Bourg'], ['streetName', 'Rue Haute'], ['city', 'Ville'], ['city', '']
    ])
    expect(results[0].feature.geometry.coordinates).toEqual([1, 2])
  })

  it('focuses forward geocoding on the viewbox center', async () => {
    const fetch = mockFetch(fixture('ban-search'))
    const provider = await createProvider({ fetch })
    await provider.forward({ search: 'Castelnaudary', filter: '*', viewbox })
    const params = requestedUrl(fetch).searchParams
    expect(Number(params.get('lat'))).toBeCloseTo(43.312199)
    expect(Number(params.get('lon'))).toBeCloseTo(1.950717)
  })

  it('reverse geocodes a location', async () => {
    const fetch = mockFetch(fixture('ban-reverse'))
    const provider = await createProvider({ fetch, url: 'https://ban.local/api' })
    const results = await provider.reverse({ lat: 43.29961, lon: 1.93729, filter: '*', limit: 2 })
    const url = requestedUrl(fetch)
    expect(url.origin + url.pathname).toBe('https://ban.local/api/reverse')
    expect(Object.fromEntries(url.searchParams)).toEqual({ lat: '43.29961', lon: '1.93729', limit: '2' })
    expect(results.map(result => result.source)).toEqual(['opendatafrance', 'opendatafrance'])
    expect(results.map(result => result.feature.properties.formattedLabel)).toEqual([
      '80 Chemin des Tournesols Castelnaudary France',
      'Chemin des Tournesols Castelnaudary France'
    ])
  })

  it('does not send a zero limit, which means no limit', async () => {
    const fetch = mockFetch(fixture('ban-search'))
    const provider = await createProvider({ fetch })
    await provider.forward({ search: 'Castelnaudary', filter: '*', limit: 0 })
    await provider.reverse({ lat: 43.29961, lon: 1.93729, filter: '*', limit: 0 })
    expect(requestedUrl(fetch, 0).searchParams.has('limit')).toBe(false)
    expect(requestedUrl(fetch, 1).searchParams.has('limit')).toBe(false)
  })

  it('handles responses without features', async () => {
    const provider = await createProvider({ fetch: mockFetch({}) })
    expect(await provider.reverse({ lat: 43, lon: 1, filter: '*' })).toEqual([])
  })

  it('returns no result when the service fails', async () => {
    const provider = await createProvider({ fetch: mockFetch(fixture('ban-short'), 400) })
    expect(await provider.forward({ search: 'ab', filter: '*' })).toEqual([])
  })

  it('does not query the service when its source is filtered out', async () => {
    const fetch = mockFetch(fixture('ban-reverse'))
    const provider = await createProvider({ fetch })
    expect(await provider.reverse({ lat: 43.29961, lon: 1.93729, filter: '*(openstreetmap)' })).toEqual([])
    expect(await provider.forward({ search: 'Castelnaudary', filter: 'kano:*' })).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  })
})
