import axios from 'axios'
import mingo from 'mingo'
import _ from 'lodash'
import crypto from 'crypto'
import app from './index.js'
/**
 * Function to retrieve session headers for authentication.
 *
 * @returns {promise<Object>} The authentication headers containing the JSESSIONID cookie.
 * @throws {Error} Throws an error if JSESSIONID is not found in the response cookies.
 */
export async function getSessionHeaders () {
  const EMAIL = app.get('email')
  const PASSWORD = app.get('password')
  const TRACCAR_URL = app.get('traccar_url')
  const payload = {
    email: EMAIL,
    password: PASSWORD
  }

  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json'
  }

  const response = await axios.post(
        `${TRACCAR_URL}/api/session`,
        new URLSearchParams(payload).toString(),
        {
          headers,
          validateStatus: status => status === 200
        }
  )

  const cookies = response.headers['set-cookie']
  let jsessionid = ''

  // Extract JSESSIONID from cookies
  if (cookies) {
    cookies.forEach(cookie => {
      if (cookie.startsWith('JSESSIONID=')) {
        jsessionid = cookie.split(';')[0].split('=')[1]
      }
    })
  }

  if (!jsessionid) {
    throw new Error('JSESSIONID not found in response cookies')
  }

  const authHeaders = {
    Cookie: `JSESSIONID=${jsessionid}`
  }

  return authHeaders
}

/**
 *  Function to retrieve the last data from Traccar and push it to the processWSQueue.
 * @note This function can trigger warnings about data already saved, this is normal and probably a good thing.
 * @throws {Error} Throws an error if the data cannot be retrieved.
 */
export async function saveLastInfosFromTraccar (deviceId = null) {
  app.logger.info('[TRACCAR_API] Fetching last data from Traccar...')
  const baseUrl = app.get('traccar_url')
  const headers = {
    Authorization: `Basic ${Buffer.from(`${app.get('email')}:${app.get('password')}`).toString('base64')}`
  }

  // get the devices
  const devicesReq = await axios.get(`${baseUrl}/api/devices?all=true`, { headers })
  // get the last positions
  const positionsReq = await axios.get(`${baseUrl}/api/positions`, { headers })

  if (devicesReq.status !== 200 || positionsReq.status !== 200) {
    throw new Error('Error getting data from Traccar')
  }

  // check if each device has a position, and skip if not
  for (const device of devicesReq.data) {
    const position = positionsReq.data.find(p => p.deviceId === device.id)
    if (!position) {
      app.logger.warn(`[TRACCAR_API] No position found for device #${device.id} in Traccar...Skipping`)
      continue
    }
    app.processWSQueue.push({ devices: [device] })
    app.processWSQueue.push({ positions: [position] })
  }
}

export async function manualFetchData (deviceId) {
  app.logger.info(`[TRACCAR_API] Fetching data for [device #${deviceId}] from Traccar...`)
  const baseUrl = app.get('traccar_url')
  const headers = {
    Authorization: `Basic ${Buffer.from(`${app.get('email')}:${app.get('password')}`).toString('base64')}`
  }
  const devicesReq = await axios.get(`${baseUrl}/api/devices?id=${deviceId}`, { headers })
  const positionsReq = await axios.get(`${baseUrl}/api/positions?deviceId=${deviceId}`, { headers })

  if (devicesReq.status !== 200 || positionsReq.status !== 200) {
    throw new Error('Error getting data from Traccar')
  }

  if (devicesReq.data.length === 0) {
    app.logger.warn(`[TRACCAR_API] Device #${deviceId} not found in Traccar...Skipping`)
    // remove the device from the known devices
    // app.knownDevices.delete(deviceId);
    return
  }

  if (positionsReq.data.length === 0) {
    app.logger.warn(`[TRACCAR_API] No position found for device #${deviceId} in Traccar ...Skipping`)
    return
  }
  app.processWSQueue.push({ devices: devicesReq.data })
  app.processWSQueue.push({ positions: positionsReq.data })
}

/**
 * Matches the given data object to a layer based on the filters defined in the application configuration.
 *
 * @param {Object} data - The data object to be matched against the filters.
 * @returns {string|null} The layer associated with the matched filter, or null if no filter is matched.
 */
function matchFilterToSubLayer (data) {
  const filters = app.get('filters')
  for (const filter of filters) {
    const query = new mingo.Query(filter.query)
    if (query.test(data)) {
      return filter.subLayer
    }
  }
  app.logger.warn(`[TRACCAR] [device #${data.deviceId}] does not match any filter...Skipping`)
  return null
}

/**
 * Unwinds the nested objects in the provided data object by moving the nested properties to the root level.
 *
 * @param {Object} data - The data object to be unwound.
 * @returns {void} - This function does not return anything as it directly modifies the provided data object.
 */
function unwind (data) {
  for (const key in data) {
    if (typeof data[key] === 'object') {
      for (const subKey in data[key]) {
        data[subKey] = data[key][subKey]
      }
      delete data[key]
    }
  }
}

/**
 * Generates a feature object based on the current device data.
 *
 * @param {Object} currentDevice - The current device data containing devices and positions.
 * @returns {Object} The generated feature object with type, geometry, properties, and layer.
 */
export function generateFeature (currentDevice) {
  let device = currentDevice.devices
  let position = currentDevice.positions
  if (!device || !position) {
    return null
  }
  const longitude = position.longitude
  const latitude = position.latitude
  unwind(device) // unwind the "attributes" object into the root level
  unwind(position)
  position = _.omit(position, ['longitude', 'latitude', 'speed', 'network', 'course', 'accuracy', 'adress'])
  // rename position.id to position.positionId
  position.positionId = position.id
  delete position.id
  // remove device.id as we already have it in position.deviceId
  device = _.omit(device, ['id'])
  const data = { ...device, ...position }
  const subLayer = matchFilterToSubLayer(data)
  if (!subLayer) { return }
  const feature = {
    _id: generateHash(data), // generating our own id, will help us avoid duplicates for the exact same data if it shows up again
    type: 'Feature',
    time: data.serverTime,
    subLayer,
    geometry: {
      type: 'Point',
      coordinates: [longitude, latitude]
    },
    properties: data
  }

  return feature
}

/**
 * Generates a hash from the given data object.
 */
function generateHash (data) {
  return crypto.createHash('md5').update(JSON.stringify(data)).digest('hex')
}

/**
    * Function to update the layers for the data in the database if the layers have changed.
    * - for example, if device #1 is in layer "A" and the filter for device #1 changes to layer "B", we need to update the layer in the database for all the data related to device #1.
    * @returns {void} - This function does not return anything.
*/
export async function updateDevicesLayers () {
  app.logger.info('[MAPS] Looking for devices with changed layers...')
  // retrieve the deviceIds from the database
  const deviceIds = await app.service('api/tracking').find({
    query: {
      $distinct: 'properties.deviceId'
    }
  })
  if (!deviceIds) {
    return
  }

  // retrieve the last data known for each device
  for (const deviceId of deviceIds) {
    const lastData = await app.service('api/tracking').find({
      query: {
        $sort: { time: -1 },
        $limit: 1,
        'properties.deviceId': deviceId
      }
    })
    const data = lastData.features[0]
    const subLayer = matchFilterToSubLayer(data.properties)
    if (subLayer && subLayer !== data.subLayer) {
      try {
        // change all the data related to this device to the new layer
        const result = await app.service('api/tracking').patch(null, { subLayer }, { query: { 'properties.deviceId': deviceId } })
        app.logger.info(`[MAPS] Updated layer for [device #${deviceId}]  from ${data.subLayer} to ${subLayer} : ${result.length} features updated`)
      } catch (error) {
        app.logger.error(`[MAPS] Error updating layer for [device #${deviceId}] : ${error.message}`)
        app.logger.error(error.stack)
      }
    }
  }
}
