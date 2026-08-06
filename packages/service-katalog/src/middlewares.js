import express from '@feathersjs/express'
import makeDebug from 'debug'

const debug = makeDebug('katalog:middlewares')

export default function () {
  const app = this
  debug('Configuring middlewares')
  app.use(express.notFound())
  app.use(express.errorHandler({ logger: app.logger }))
}
