import WebSocket from 'ws'
import _ from 'lodash'
import app from './index.js'

import { getSessionHeaders, saveLastInfosFromTraccar, generateFeature, updateDevicesLayers, manualFetchData } from './helper.js'

export default async function connectWebSocket () {
  app.knownDevices = {}
  app.processWSQueue = []
  updateDevicesLayers() // if the config changed, we update the history of devices so we can display them on the map correctly
  // Get the TTL for the traccar layer from the catalog
  const catalogService = app.services['api/catalog']
  const catalog = await catalogService.find({ query: { name: 'Layers.TRACCAR' } })
  if (catalog.total === 0) {
    app.logger.error('[WEBSOCKET] TRACCAR layer not found in the catalog')
    throw new Error('TRACCAR layer not found in the catalog')
  }
  app.ttl = catalog.data[0].ttl || null
  app.logger.info(`[MAPS] TTL for TRACCAR layer: ${app.ttl}`)
  const TRACCAR_WS_URL = app.get('traccar_url').replace('http', 'ws') + '/api/socket'

  let headers
  try {
    headers = await getSessionHeaders(app)
  } catch (error) {
    app.logger.error(`[WEBSOCKET] Error getting session headers : ${error.message}`)
    throw error
  }
  const ws = new WebSocket(TRACCAR_WS_URL, { headers })
  ws.on('open', async () => {
    // TODO
    app.logger.info('[WEBSOCKET] Connected to WebSocket server')
    try {
      // technically when we connect to the websocket we should get the last positions of all devices immediately,
      // but we don't get the devices data, so its better to fetch everything from the API
      // this will trigger some warnings about data already saved, its normal
      // every 10min we fetch the last data from traccar (sometimes the websocket is not reliable and doesn't send events)
      setInterval(saveLastInfosFromTraccar, 60 * 1000 * 15) // 15 minutes
    } catch (error) {
      app.logger.error(`[WEBSOCKET] Error getting last infos from Traccar : ${error.message}`)
      throw error
    }
    setInterval(processWSEventInQueue, 10)
  })

  ws.on('message', async (data) => {
    data = JSON.parse(data)
    // app.logger.info(`[WEBSOCKET] Received data from WebSocket server: ${JSON.stringify(data)}`);
    // we store the data in a queue to process it later on the same thread
    app.processWSQueue.push(data)
  })

  ws.on('close', () => {
    app.logger.info('[WEBSOCKET] Disconnected from WebSocket server')
    process.exit(1)
  })

  ws.on('error', (error) => {
    app.logger.error(`[WEBSOCKET] Error: ${error.message}`)
    throw error
  })
}

/**
 * Asynchronously sends data for a specific device to update or create a feature.
 *
 * @param {string} deviceId - The ID of the device for which data is being sent.
 * @returns {Promise<void>} - A Promise that resolves once the data has been successfully updated or created.
 */
async function sendData (deviceId) {
  const currentDevice = app.knownDevices[deviceId]
  if (currentDevice.lock) {
    return
  }
  if (_.isEmpty(currentDevice.positions) || _.isEmpty(currentDevice.devices)) {
    const missingData = []
    if (_.isEmpty(currentDevice.positions)) {
      missingData.push('positions')
    }
    if (_.isEmpty(currentDevice.devices)) {
      missingData.push('devices')
    }
    missingData.forEach(dataType =>
      app.logger.warn(`[TRACCAR] [device #${deviceId}] missing ${dataType} data, setting a 5s timeout to fetch it manually through the API`)
    )
    currentDevice.timeout = setTimeout(async () => {
      try {
        await manualFetchData(deviceId)
        currentDevice.timeout = null
      } catch (error) {
        app.logger.error(`[TRACCAR] [device #${deviceId}] Error fetching missing data : ${error.message}`)
      }
    }, 5000)

    return
  }
  if (currentDevice.timeout) {
    app.logger.info(`[TRACCAR] [device #${deviceId}] Got missing data, clearing timeout`)
    clearTimeout(currentDevice.timeout)
    currentDevice.timeout = null
  }
  currentDevice.lock = true
  // generate a GeoJSON feature for the device
  const feature = generateFeature(currentDevice)
  // send the feature to Maps

  if (!feature) {
    app.logger.warn(`[MAPS] [device #${deviceId}] Invalid data, skipping`)
    return
  }
  try {
    // check the difference between the last position and the current time, if it's greater than the TTL we skip the data
    const lastPositionTime = new Date(feature.time)
    if (app.ttl && (Date.now() - (lastPositionTime.getTime()) > app.ttl * 1000)) {
      app.logger.warn(`[MAPS] [device #${deviceId}] Last position is older than TTL, skipping`)
      currentDevice.positions = {}
      currentDevice.devices = {}
      currentDevice.lock = false
      return
    }
    await app.service('api/tracking').create(feature)
    app.logger.info(`[MAPS] [device #${deviceId}] New data saved`)
  } catch (error) {
    if (error.message.includes('E11000')) {
      app.logger.warn(`[MAPS] [device #${deviceId}] Data already saved`)
    } else {
      app.logger.error(`[MAPS] [device #${deviceId}] Error saving data: ${error.message}`)
      throw error
    }
  }
  currentDevice.positions = {}
  currentDevice.devices = {}
  currentDevice.lock = false
}

// We use a queue to process the events from the WebSocket in order...
async function processWSEventInQueue () {
  while (app.processWSQueue.length > 0) {
    const event = app.processWSQueue.shift() // get the next event
    const type = Object.keys(event)[0] // type of traccar event (positions, device,?...)
    if (!type) {
      return // Sometimes traccar sends empty events (e.g. {})
    }
    for (const device in event[type]) { // loop through the devices in the event (e.g. {positions: [device1, device2]})
      const data = event[type][device] // get the data from the event for the device
      const deviceId = data.deviceId || data.id // get the device ID from the data (for type positions it's deviceId, for type device it's id)
      if (type && deviceId) { //
        // Check if we already know this device from the app.knownDevices object
        if (!app.knownDevices[deviceId]) {
          // add the device to the app.knownDevices object
          app.knownDevices[deviceId] = {
            positions: {}, // the position data of the device (key of the dictionary in event)
            devices: {}, // the device data of the device (key of the dictionary in event)
            lock: false, // a lock to prevent multiple calls to the sendData function
            send: _.throttle( // create a throttled function to send the data to Maps, with a delay of UPDATE_INTERVAL
              sendData.bind(null, deviceId), // the function to execute
              app.get('update_interval'), // the delay in ms
              { leading: false, trailing: true } // leading is false to not execute the function immediately, trailing is true to execute it at the end of the interval
            )
          }
          app.logger.info(`[TRACCAR] Added [device #${deviceId}] to known devices`)
        }
        app.knownDevices[deviceId][type] = data
        app.knownDevices[deviceId].send() // tries to send the data to Maps
      }
    }
  }
}
