import fs from 'fs-extra'
import _ from 'lodash'
import makeDebug from 'debug'
import winston from 'winston'
import 'winston-daily-rotate-file'
import cors from 'cors'
import feathers from '@feathersjs/feathers'
import configuration from '@feathersjs/configuration'
import express from '@feathersjs/express'
import distribution from '@kalisio/feathers-distributed'
import { initKano } from './providers/index.js'
import hooks from './hooks.js'
import routes from './routes.js'
import middlewares from './middlewares.js'

import { MongoClient } from 'mongodb'
import services from './services/index.js'

// Initialize debugger to be used in feathers
feathers.setDebug(makeDebug)

export async function createServer () {
  const app = express(feathers())
  app.configure(configuration())
  app.use(cors())

  // Logger
  const config = app.get('logs')
  const logPath = _.get(config, 'DailyRotateFile.dirname')
  // This will ensure the log directory does exist
  fs.ensureDirSync(logPath)
  app.logger = winston.createLogger({
    level: (process.env.NODE_ENV === 'development' ? 'verbose' : 'info'),
    transports: [
      new winston.transports.Console(_.get(config, 'Console')),
      new winston.transports.DailyRotateFile(_.get(config, 'DailyRotateFile'))
    ]
  })

  // Top-level error handler
  process.on('unhandledRejection', (reason, p) =>
    app.logger.error('Unhandled Rejection: ', reason)
  )

  // Set up database
  app.set('mongoClient', MongoClient.connect(app.get('dbUrl')).then(client => client.db()))

  // Set up json parser
  app.use(express.json())
  app.configure(express.rest())

  // Get distributed services
  app.configure(distribution(app.get('distribution')))
  const kano = await initKano(app)
  app.set('kano', kano)

  // Set up our services (see `services/index.js`)
  app.configure(services)

  // Register hooks
  app.hooks(hooks)

  // Configure API routes
  const port = app.get('port')
  app.logger.info('Configuring HTTP server at port ' + port.toString())
  const server = await app.listen(port)
  server.app = app
  server.app.logger.info('Server started listening on port ' + port.toString())

  app.configure(routes)
  // Configure middlewares - always has to be last
  app.configure(middlewares)

  return server
}
