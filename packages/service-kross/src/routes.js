import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import _ from 'lodash'
import makeDebug from 'debug'
import errors from '@feathersjs/errors'
import { Providers } from './providers.js'
import { toGeometry } from './utils.js'

const debug = makeDebug('kross:routes')
const __dirname = path.dirname(fileURLToPath(import.meta.url))

const OPERATIONS = ['intersect']

// Express 4 does not forward rejected promises to the error handler
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

export default async function (app) {
  const packageInfo = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json')))
  const apiPath = app.get('apiPath')
  const paginate = app.get('paginate')

  app.get(`${apiPath}/healthcheck`, (req, res) => {
    debug(`${req.method} ${req.originalUrl}`)
    const response = {
      name: 'service-kross',
      // Allow to override version number for custom build
      version: (process.env.VERSION ? process.env.VERSION : packageInfo.version)
    }
    if (process.env.BUILD_NUMBER) {
      response.buildNumber = process.env.BUILD_NUMBER
    }
    res.json(response)
  })

  app.get(`${apiPath}/capabilities/:operation`, asyncHandler(async (req, res) => {
    const operation = req.params.operation
    if (!OPERATIONS.includes(operation)) throw new errors.BadRequest(`Unsupported operation ${operation}`)
    const providers = Providers.get(app).filter(provider => typeof provider[operation] === 'function')
    const results = await Promise.allSettled(providers.map(provider => provider.capabilities({ operation })))
    const sources = []
    results.forEach((result) => {
      if (result.status !== 'fulfilled') app.logger.error(result.reason.toString())
      // Sources are listed in the providers order
      else sources.push(...result.value)
    })
    res.json({ sources })
  }))

  app.post(`${apiPath}/intersect`, asyncHandler(async (req, res) => {
    debug(`${req.method} ${req.originalUrl}`)
    const body = req.body || {}
    const geometry = toGeometry(body.geometry)
    if (!geometry) throw new errors.BadRequest('Intersection expects a GeoJSON geometry or feature as geometry')
    const options = {
      geometry,
      filter: _.isString(body.sources) ? body.sources : '*',
      clip: body.clip === true
    }
    if (_.has(body, 'limit')) options.limit = _.toInteger(body.limit)
    else options.limit = _.get(paginate, 'default.intersect', 1000)
    if (!(options.limit > 0)) throw new errors.BadRequest('Intersection expects a positive limit')
    if (_.has(paginate, 'max.intersect')) options.limit = Math.min(options.limit, _.get(paginate, 'max.intersect'))

    const providers = Providers.get(app).filter(provider => typeof provider.intersect === 'function')
    const results = await Promise.allSettled(providers.map(provider => provider.intersect(options)))
    const features = []
    results.forEach((result) => {
      if (result.status !== 'fulfilled') {
        app.logger.error(result.reason.toString())
        return
      }
      result.value.forEach(({ source, feature }) => {
        feature.kross = { source }
        features.push(feature)
      })
    })
    res.json({ type: 'FeatureCollection', features: _.take(features, options.limit) })
  }))
}
