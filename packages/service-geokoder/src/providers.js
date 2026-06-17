import {
  createKanoProvider,
  createNodeGeocoderProvider,
  createMBTilesProvider,
  createGeokoderProvider
} from './providers/index.js'

export const Providers = {
  async initialize (app) {
    app.providers = []
    const results = await Promise.allSettled([
      createKanoProvider(app),
      createNodeGeocoderProvider(app),
      createMBTilesProvider(app),
      createGeokoderProvider(app)
    ])
    results.forEach((result) => {
      if (result.status !== 'fulfilled') {
        app.logger.error(result.reason.toString())
        return
      }
      if (result.value) { app.providers.push(result.value) }
    })
  },
  get (app) {
    return app.providers
  }
}
