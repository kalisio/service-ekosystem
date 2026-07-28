import { fileURLToPath } from 'url'
import fs from 'fs-extra'
import path from 'path'
import { stripSlashes } from '@feathersjs/commons'

// provider
//  => liste de sources
//  => forward, reverse
//
// kano feature services = provider
//  => sources = rte-units, hubeau-stations ...

export default function (app) {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = path.dirname(__filename)
  const packageInfo = fs.readJsonSync(path.join(__dirname, '..', 'package.json'))

  app.get('/healthcheck', (req, res, next) => {
    const response = {
      name: 'geokatcher',
      // Allow to override version number for custom build
      version: (process.env.VERSION ? process.env.VERSION : packageInfo.version)
    }
    if (process.env.BUILD_NUMBER) {
      response.buildNumber = process.env.BUILD_NUMBER
    }
    res.json(response)
  })

  app.post('/test', async (req, res) => {
    // set the coordinates of the point with the name nicolas
    const lat = parseFloat(req.body.lat)
    const long = parseFloat(req.body.long)
    const currentTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    app.logger.info(`new coordinates : ${lat}, ${long} at time ${currentTime}`)
    const apiPath = app.get('apiPath')
    const service = app.services[stripSlashes(`${apiPath}/features`)]
    let feature = await service.find({ query: { 'properties.name': 'Nicolas' } })
    feature = feature.features[0]
    feature.geometry.coordinates = [long, lat]
    feature = await service.patch(feature._id, { geometry: feature.geometry })
    res.status(200).json(feature)
  })

  let interval
  app.post('/test2', async (req, res) => {
    // move a point to a new location around the point
    // 44°22'48.0"N 0°26'40.9"W
    const latPont = 44.380000
    const longPont = -0.444694

    interval = setInterval(async () => {
      // we generate a new point around (100km)
      const lat = latPont + (Math.random() * 0.9 - 0.45)
      const long = longPont + (Math.random() * 0.9 - 0.45)
      const currentTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      app.logger.info(`new coordinates : ${lat}, ${long} at time ${currentTime}`)
      const apiPath = app.get('apiPath')
      const service = app.services[stripSlashes(`${apiPath}/features`)]
      let feature = await service.find({ query: { 'properties.name': 'nicolas' } })
      feature = feature.features[0]
      feature.geometry.coordinates = [long, lat]
      feature = await service.patch(feature._id, { geometry: feature.geometry })
    }, 1000)
    res.status(200).json({ message: 'ok' })
  }
  )

  app.post('/test3', async (req, res) => {
    const apiPath = app.get('apiPath')
    const service = app.services[stripSlashes(`${apiPath}/features`)]
    const feature = await service.find({ query: { 'properties.deviceId': 19 } })
    const toSend = feature.features[0]
    toSend.path = 'api/features'

    // emit a patch event without actually patching the feature
    service.emit('patched', toSend)
    res.status(200).json({ message: 'ok' })
  })

  app.post('/clear', async (req, res) => {
    clearInterval(interval)
    res.status(200).json({ message: 'ok' })
  }
  )
}
