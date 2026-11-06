import { createDuckDBProvider } from './providers/index.js'

// Provider contract:
// {
//   name: String,
//   capabilities ({ operation }) => [sourceName],
//   intersect ({ geometry, filter, limit, clip }) => [{ source, feature }],
//   close () => Promise (optional, called on server close)
// }
export const Providers = {
  async initialize (app) {
    app.providers = []
    const results = await Promise.allSettled([
      createDuckDBProvider(app)
    ])
    results.forEach((result) => {
      if (result.status !== 'fulfilled') {
        app.logger.error(result.reason.toString())
        return
      }
      if (result.value) app.providers.push(result.value)
    })
  },
  get (app) {
    return app.providers || []
  },
  async close (app) {
    await Promise.allSettled(Providers.get(app).filter(provider => typeof provider.close === 'function').map(provider => provider.close()))
    app.providers = []
  }
}
