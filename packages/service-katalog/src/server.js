import fs from 'node:fs'
import https from 'node:https'
import distribution, { finalize } from '@kalisio/feathers-distributed'
import { createApplication } from '@kalisio/kdk-core-api'
import { createCatalogService, createDefaultCatalogLayers, createCatalogFeaturesServices } from '@kalisio/kdk-map-api'
import hooks from './hooks.js'
import channels from './channels.js'
import routes from './routes.js'
import middlewares from './middlewares.js'
import { loadLayers, loadCategories, loadSublegends } from './layers.js'

export async function createServer (config = {}) {
  const app = createApplication(config)

  // Setup distribution first so that every service declared below gets published
  const distributionConfig = app.get('distribution')
  if (distributionConfig) await app.configure(distribution(distributionConfig))

  // Handle top level errors
  process.on('unhandledRejection', (reason, p) =>
    app.logger.error('Unhandled Rejection: ', reason)
  )
  process.on('SIGINT', async () => {
    app.logger.info('Received SIGINT signal running teardown')
    await app.teardown()
    process.exit(0)
  })
  process.on('SIGTERM', async () => {
    app.logger.info('Received SIGTERM signal running teardown')
    await app.teardown()
    process.exit(0)
  })

  await app.db.connect()

  // The catalog content is built from the configuration files
  const layers = await loadLayers(app)
  const categories = await loadCategories(app)
  const sublegends = await loadSublegends(app)
  app.set('catalog', { ...app.get('catalog'), layers, categories, sublegends })

  // Setup services
  await createCatalogService.call(app)
  await createDefaultCatalogLayers.call(app)
  await createCatalogFeaturesServices.call(app)

  // Register hooks
  app.hooks(hooks)
  // Set up real-time event channels
  await app.configure(channels)
  // Configure API routes
  await app.configure(routes)
  // Configure middlewares - always has to be last
  await app.configure(middlewares)

  // Last lauch server
  const httpsConfig = app.get('https')
  let server
  if (httpsConfig) {
    const port = httpsConfig.port || app.get('port')
    server = https.createServer({
      key: fs.readFileSync(httpsConfig.key),
      cert: fs.readFileSync(httpsConfig.cert)
    }, app)
    app.logger.info('Configuring HTTPS server at port ' + port.toString())
    server = await server.listen(port)
  } else {
    const port = app.get('port')
    app.logger.info('Configuring HTTP server at port ' + port.toString())
    server = await app.listen(port)
  }
  server.on('close', () => {
    if (distributionConfig) finalize(app)
  })
  server.app = app
  server.app.logger.info('Server started listening')

  return server
}
