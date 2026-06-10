import { kdk } from '@kalisio/kdk-core-api'
import express from '@feathersjs/express'
import distribution, { finalize } from '@kalisio/feathers-distributed'
import { logger } from './logger.js'
import { services } from './services/index.js'
import { loadLayers, loadCategories, loadSublegends } from './layers.js'
import { createDefaultCatalogLayers, createCatalogFeaturesServices } from '@kalisio/kdk-map-api'
const { notFound, errorHandler } = express

export class Server {
  constructor () {
    this.app = kdk()

    this.app.use(notFound())
    this.app.use(errorHandler({ logger }))

    this.app.hooks({
      around: { all: [] },
      before: {},
      after: {},
      error: {}
    })
  }

  async run () {
    const port = this.app.get('port')
    const host = this.app.get('host')

    this.app.configure(distribution(this.app.get('distribution')))

    await this.app.db.connect()

    const layers = await loadLayers(this.app)
    const categories = await loadCategories(this.app)
    const sublegends = await loadSublegends(this.app)
    this.app.set('catalog', Object.assign({}, this.app.get('catalog'), { layers, categories, sublegends }))

    await services(this.app)
    await createDefaultCatalogLayers.call(this.app)
    await createCatalogFeaturesServices.call(this.app)
    const server = await this.app.listen(port)
    logger.info(`Feathers app listening on http://${host}:${port}`)

    server.on('close', () => finalize(this.app))
  }
}

export function createServer () {
  return new Server()
}
