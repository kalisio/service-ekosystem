import feathers from '@feathersjs/feathers'
import configuration from '@feathersjs/configuration'
import winston from 'winston'

import express from '@feathersjs/express'
import distribution from '@kalisio/feathers-distributed'
import connectWebSocket from './traccar.js'
import _ from 'lodash'

const app = express(feathers())
app.configure(configuration())

app.logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console({ format: winston.format.combine(winston.format.colorize(), winston.format.simple()) })
  ]
})
// check if in the config we have TRACCAR_EMAIL, TRACCAR_PASSWORD, TRACCAR_URL
const status = { TRACCAR_EMAIL: app.get('email'), TRACCAR_PASSWORD: app.get('password'), TRACCAR_URL: app.get('traccar_url') }
_.forEach(status, (value, key) => {
  if (!value) {
    app.logger.error(`${key} is not set in the configuration`)
    process.exit(1)
  }
})

// Consumes the services from the distribution
app.configure(distribution())

const interval = setInterval(async () => {
  app.logger.info('[DISTRIBUTION] Waiting for Maps service to be available...')
  // check if we have the api/features and api/catalog services
  const featuresService = app.services['api/features'] || null
  const catalogService = app.services['api/catalog'] || null
  if (featuresService && catalogService) {
    // if(true) {
    app.logger.info('[DISTRIBUTION] features and catalog services available')
    clearInterval(interval)
    // Connect to Traccar WebSocket
    await connectWebSocket()
  }
}, 3000)

// health check route
app.get('/healthcheck', (req, res) => {
  // we check if the services are available and return ok if they are
  const featuresService = app.services['api/features'] || null
  const catalogService = app.services['api/catalog'] || null
  if (featuresService && catalogService) {
    return res.json({ status: 'ok' })
  }
  return res.status(500).json({ status: 'services not available' })
})

app.listen(app.get('port'))

export default app
