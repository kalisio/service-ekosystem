import {
  createKanoProvider,
  createOpenDataFranceProvider,
  createOpenStreetMapProvider,
  createMBTilesProvider,
  createGeokoderProvider
} from './providers/index.js'

import { createDuckDBProvider } from '@kalisio/core-service/providers'

export const Providers = {
  async initialize (app) {
    app.providers = []
    const results = await Promise.allSettled([
      createKanoProvider(app),
      createOpenDataFranceProvider(app),
      createOpenStreetMapProvider(app),
      createMBTilesProvider(app),
      createGeokoderProvider(app),
      createDuckDBProvider(app)
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
