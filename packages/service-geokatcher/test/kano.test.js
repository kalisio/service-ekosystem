import { expect, it, beforeAll } from 'vitest'

async function kanoTest () {
  // this, is the global object with all the global variables
  let app, kano

  beforeAll(() => {
    app = this.app
    kano = app.get('kano')
  })

  it('kano services are available', async () => {
    // we check if app.services contains the catalog, features and hubeau-hydro services
    expect(app.services['api/catalog']).toBeDefined()
    expect(app.services['api/features']).toBeDefined()
    expect(app.services['api/hubeau-hydro-stations']).toBeDefined()
  }, 10000)

  it('getLayerData with no name should throw a BadRequest with message "Layer name is required"', async () => {
    try {
      await kano.getLayerData()
    } catch (error) {
      expect(error.message).toBe('Layer name is required')
    }
  }, 10000)

  it('getLayerData with name "xxx" should throw a NotFound with message "Layer not found"', async () => {
    try {
      await kano.getLayerData('xxx')
    } catch (error) {
      expect(error.message).toBe('Layer not found')
    }
  }, 10000)

  it('getLayerData with name "hubeau_hydro" should return the corresponding layer', async () => {
    const layer = await kano.getLayerData('hubeau_hydro')
    expect(layer).toBeDefined()
    expect(layer.name).toBe('Layers.HUBEAU_HYDRO')
  }, 10000)

  it('getLayerFeatures with no layer should throw a BadRequest with message "Layer is required"', async () => {
    try {
      await kano.getLayerFeatures()
    } catch (error) {
      expect(error.message).toBe('Layer is required')
    }
  }, 10000)

  it('getLayerFeatures with layer "hubeau_hydro" and no filters should return 10 features', async () => {
    const layer = await kano.getLayerData('hubeau_hydro')
    const features = await kano.getLayerFeatures(layer)
    expect(features).toBeDefined()
    expect(features.features.length).toBe(10)
  }, 10000)

  it('getLayerFeatures with layer "hubeau_hydro" and filter code_station #O962053101 should return 1 feature', async () => {
    const layer = await kano.getLayerData('hubeau_hydro')
    const features = await kano.getLayerFeatures(layer, { 'properties.code_station': '#O962053101' })
    expect(features).toBeDefined()
    expect(features.features.length).toBe(1)
  }, 10000)
}

export default kanoTest
