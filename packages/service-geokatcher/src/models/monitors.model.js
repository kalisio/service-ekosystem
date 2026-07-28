import { mongoose } from 'mongoose'
import { unescape } from 'mongo-escape'
import { stripSlashes } from '@feathersjs/commons'
import makeDebug from 'debug'
import { find } from 'mingo'
import fetch from 'node-fetch'

import _ from 'lodash'
import cron from 'node-cron'

const debug = makeDebug('geokatcher:models:monitors')
const monitorsModel = {
  kano: null,
  app: null,
  activeMonitors: {},
  activeServices: [],
  allowedEvents: ['created', 'updated', 'patched', 'removed'],
  model: null,

  /**
     * Create the mongoose model for the monitors
     * @param {*} app  The feathers app
     * @returns {Object}  The mongoose model created
     */
  createModel (app) {
    const Schema = mongoose.Schema
    const monitorsSchema = new Schema(
      {
        target: {
          name: { type: String, required: true },
          filter: { type: Object, required: false },
          layerInfo: { type: Object, required: false }
        },
        zone: {
          name: { type: String, required: true },
          filter: { type: Object, required: false },
          layerInfo: { type: Object, required: false }
        },
        monitor: {
          name: { type: String, required: true },
          description: { type: String, required: false },
          type: { type: String, required: true },
          trigger: { type: Object, required: true },
          enabled: { type: Boolean, required: true },
          lastRun: { type: Object, required: false },
          evaluation: {
            alertOn: { type: String, required: true },
            type: { type: String, required: true },
            maxDistance: { type: Number, required: false, min: 0 },
            minDistance: { type: Number, required: false, min: 0 }
          },
          action: { type: Object, required: false }

        }

      },
      {
        timestamps: true,
        versionKey: false
      }
    )

    this.app = app
    this.model = mongoose.model('monitors', monitorsSchema)
    // app.set('monitorsModel', Model);
    return this.model
  },

  /**
   * Start the existing monitors that are enabled
   */
  startExistingMonitors () {
    this.model.find({ 'monitor.enabled': true }).then((monitors) => {
      monitors.forEach(async (monitorObject) => {
        // if the monitor is enabled and not already running
        if (!(this.activeMonitors[monitorObject._id])) {
          await this.startMonitor(monitorObject.toObject())
        }
      })
    })
  },

  /**
    * Evaluate the monitor object
    * @param {Object} monitorObject  The monitor object to evaluate, it will be modified by the function, the lastRun object will be updated
    * @param {Boolean} throwError  If true, the function will throw an error if the evaluation fails, if false, the error will be caught and specified in the lastRun object
    * @returns {Object}  The data that match the evaluation
    */
  async evaluate (monitorObject, throwError = false) {
    const data = {}
    let error
    let targetLayer
    let zoneLayer
    let zoneFeatureCollection
    try {
      // If the source isn't inRequest, we need to get the layer data from the provider (Kano)
      if (_.get(monitorObject.target, 'source') !== 'inRequest') {
        targetLayer = await this.kano.getLayerData(monitorObject.target.name).catch((err) => {
          throw err
        })

        // If the layer is not found, we stop the evaluation, the error is already thrown
        if (!targetLayer) {
          return
        }
        // targetFeatureCollection = await this.kano.getLayerFeatures(
        //   targetLayer,
        //   monitorObject.target.filter
        // )
        // // If the feature collection is empty, we stop the evaluation, there won't be any data to compare
        // if (!targetFeatureCollection.features) {
        //   return
        // }
        // The Kano service and layerId are added to the monitorObject to be able to use them for future events on the service
        monitorObject.target.layerInfo = {
          kanoService: _.get(targetLayer, 'probeService', targetLayer.service),
          layerId: targetLayer._id
        }
      }
      // If the source isn't inRequest, we need to get the layer data from the provider (Kano)
      if (_.get(monitorObject.zone, 'source') !== 'inRequest') {
        zoneLayer = await this.kano.getLayerData(monitorObject.zone.name).catch((err) => {
          throw err
        })
        // If the layer is not found, we stop the evaluation, the error is already thrown
        if (!zoneLayer) {
          return
        }

        zoneFeatureCollection = await this.kano.getLayerFeatures(
          zoneLayer,
          monitorObject.zone.filter
        )
        // If the feature collection is empty, we stop the evaluation, there won't be any data to compare
        if (!zoneFeatureCollection.features) {
          return
        }

        // The Kano service and layerId are added to the monitorObject to be able to use them for future events on the service
        monitorObject.zone.layerInfo = {
          kanoService: _.get(zoneLayer, 'probeService', zoneLayer.service),
          layerId: zoneLayer._id
        }
      }

      // Compare the two layers and return the data that match the evaluation
      // data.result = await this.kano.compareLayers(
      //   targetFeatureCollection,
      //   zoneLayer,
      //   monitorObject.zone.filter,
      //   monitorObject.monitor
      // )
      data.result = await this.kano.compareLayers(
        zoneFeatureCollection,
        targetLayer,
        monitorObject.target.filter,
        monitorObject.monitor
      )
    } catch (err) {
      error = err

      // if throwError is true, we escalate the error to the caller
      if (throwError) {
        throw error
      } else {
        this.app.logger.error(`Error while evaluating monitor ${monitorObject.monitor.name}: ${error.message}`)
        debug('Error while evaluating monitor %s: %O', monitorObject.monitor.name, error)
      }
    } finally {
      data.status = { success: !error, ...(error ? { error: { message: error.message, data: error.data } } : {}) }
    }
    return data
  },

  /**
     * Start the monitor and add it to the list of running monitors
     * @param {Object} monitorObject  The monitor object to start
     * @note The monitor is started with the cron library, the monitor will be evaluated at the trigger time
     * @todo Add the possibility to start the monitor with real time events from the provider
     * @returns {Promise<void>}
     */
  async startMonitor (monitorObject) {
    if (monitorObject.monitor.type === 'cron') {
      if (this.activeMonitors[monitorObject._id]) {
        this.app.logger.info(`Monitor ${monitorObject.monitor.name} was already running, stopping it`)
        debug('Monitor %s was already running, stopping it', monitorObject.monitor.name)
        this.activeMonitors[monitorObject._id].cron.stop()
      }

      const cronjob = cron.schedule(
        monitorObject.monitor.trigger,
        async () => {
          await runMonitor.bind(this)(monitorObject)
        }
      )

      this.activeMonitors[monitorObject._id] = { cron: cronjob, monitor: monitorObject }
    }

    if (monitorObject.monitor.type === 'event') {
      const apiPath = this.app.get('apiPath')
      const targetServiceName = _.get(monitorObject, 'target.layerInfo.kanoService', null)
      const zoneServiceName = _.get(monitorObject, 'zone.layerInfo.kanoService', null)
      const apiPathSlash = stripSlashes(apiPath)
      const targetService = this.app.services[`${apiPathSlash}/${targetServiceName}`]
      const zoneService = this.app.services[`${apiPathSlash}/${zoneServiceName}`]

      if (!this.activeServices.includes(targetServiceName)) {
        this.activeServices.push(targetServiceName)
        this.allowedEvents.forEach((event) => {
          targetService.on(event, async (data) => {
            handleServiceEvents(this, data, event)
          })
        })
      }
      if (!this.activeServices.includes(zoneServiceName)) {
        this.activeServices.push(zoneServiceName)
        this.allowedEvents.forEach((event) => {
          zoneService.on(event, async (data) => {
            handleServiceEvents(this, data, event)
          })
        })
      }

      this.activeMonitors[monitorObject._id] = { monitor: monitorObject }
    }
    this.app.logger.info(`Monitor ${monitorObject.monitor.name} started`)
    debug('Monitor %s started', monitorObject.monitor.name)
  },

  /**
     * Stops and remove the monitor from the list of running monitors
     * @param {*} monitorObject  The monitor object to stop
     */
  stopMonitor (monitorObject) {
    if (this.activeMonitors[monitorObject._id]) {
      if (monitorObject.monitor.type === 'cron') {
        this.activeMonitors[monitorObject._id].cron.stop()
      }
      delete this.activeMonitors[monitorObject._id]
      this.app.logger.info(`Monitor ${monitorObject.monitor.name} stopped`)
      debug('Monitor %s stopped', monitorObject.monitor.name)
    }
  },

  /**
   * Executes the actions associated with a monitor based on its status.
   *
   * @param {Object} monitorObject - The monitor object containing the monitor details.
   * @param {string} status - The status of the monitor.
   * @returns {Date} - The date and time if the action was run. null if the action was skipped.
   */
  async runActions (monitorObject, status, data) {
    const monitor = monitorObject.monitor
    const action = monitor.action
    const cooldown = action.cooldown * 1000 ?? 0
    const now = new Date()
    const lastActionRun = new Date(monitor.lastRun.lastActionRun) ?? 0
    const onCooldown = now - lastActionRun < cooldown
    if (status === 'still firing' && onCooldown) {
      this.app.logger.info(`Monitor ${monitor.name} is still firing but the cooldown is not over yet, skipping action`)
      debug('Monitor %s is still firing but the cooldown is not over yet, skipping action', monitor.name)
      return
    }

    this.app.logger.info(`Monitor ${monitor.name} is ${status}`)
    debug('Monitor %s is %s', monitor.name, status)
    // Emit an event to the monitor service,
    // so any listeners in the distributed system can react to the monitor status
    this.app.services.monitor.emit(monitor.name, { status })
    if (!action.url) {
      return
    }

    const actionInfo = {
      url: action.url,
      method: _.get(action, 'additionalProperties.method', 'POST'),
      body: _.get(action, 'additionalProperties.body', {}),
      headers: _.get(action, 'additionalProperties.headers', { 'Content-Type': 'application/json' })
    } // we will store the default action info here to send it at the end

    if (action.type === 'slack-webhook') {
      actionInfo.body = {
        attachments: [
          {
            color: status === 'firing' ? '#f52a2a' : status === 'still firing' ? '#fc7703' : '#03fc07',
            blocks: [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: `*[GeoKatcher]*\n*Monitor :* \`${monitor.name}\`\n*Status :* ${status}`
                }
              }
            ]
          }
        ]
      }
    }
    if (action.type === 'crisis-webhook') {
      actionInfo.body = { organisation: action.additionalProperties.organisation }
      actionInfo.headers.Authorization = 'Bearer ' + action.additionalProperties.token
      // On firing, we create a crisis event
      if (status === 'firing') {
        actionInfo.body.data = {
          template: action.additionalProperties.data.template,
          name: action.additionalProperties.data.name || monitor.name,
          description: action.additionalProperties.data.description || monitor.description
        }
        // we add the location if the data is not empty
        if (data.length > 0) {
          actionInfo.body.data.location = {
            type: 'Feature',
            geometry: {
              type: 'GeometryCollection',
              geometries: [data[0].targetFeatures.geometry].concat(data[0].zoneFeatures.map((feature) => feature.geometry))
            },
            properties: {
              name: monitor.name,
              date: monitor.lastRun.date,
              condition: monitor.evaluation.type,
              alertOn: monitor.evaluation.alertOn
            }
          }
        }
      } else if (status === 'no longer firing') {
        // On "no longer firing", we close the crisis event
        actionInfo.body.operation = 'remove'
        actionInfo.body.id = action.additionalProperties.knownAlertId
        // remove the knownAlertId from the monitor
        delete monitor.lastRun.knownAlertId
      } else {
        // On still firing we ignore the action
        return
      }
    }

    if (action.type === 'custom-request') {
      // we replace the string "%monitorName%" and %monitorStatus% with the name of the monitor in the body and headers and the url
      actionInfo.url = actionInfo.url.replace(/%monitorName%/g, monitor.name).replace(/%monitorStatus%/g, status)
      actionInfo.headers = JSON.parse(JSON.stringify(actionInfo.headers).replace(/%monitorName%/g, monitor.name).replace(/%monitorStatus%/g, status))
      actionInfo.body = JSON.parse(JSON.stringify(actionInfo.body).replace(/%monitorName%/g, monitor.name).replace(/%monitorStatus%/g, status))
    }
    // we send the request
    this.app.logger.info(`Sending ${action.type} for monitor ${monitor.name}`)
    debug('Sending %s for monitor %s', action.type, monitor.name)
    const res = await fetch(actionInfo.url, {
      method: actionInfo.method,
      headers: actionInfo.headers,
      body: JSON.stringify(actionInfo.body)
    })
    // if the request was not successful, we log the error
    if (!res.ok) {
      const responseText = await res.text()
      this.app.logger.error(`Error while sending ${action.type} for monitor ${monitor.name}: ${res.statusText} - ${responseText}`)
      debug('Error while sending %s for monitor %s: %s', action.type, monitor.name, res.statusText)
    } else if (action.type === 'crisis-webhook' && status === 'firing') {
      // if the action was crisis-webhook and the status was firing, we store the knownAlertId in the monitor
      const response = await res.json()
      monitor.action.additionalProperties.knownAlertId = response._id
    }
    // we update the lastActionRun date
    monitor.lastRun.lastActionRun = now
  },
  /**
   * Determines the firing status of a monitor based on the evaluation criteria set in the monitor object and the data received as input.
   * @param {object} monitorObject - The monitor object containing the evaluation criteria and last run information.
   * @param {array} data - The data received as input for the monitor evaluation.
   * @returns {string} - The firing status of the monitor.
   * @note The firing status can be one of the following: 'firing', 'still firing', 'no longer firing', 'not firing'.
   */
  determineFiringStatus (monitorObject, data) {
    const { evaluation, lastRun } = monitorObject.monitor
    const lastRunAlert = lastRun?.alert
    const { alertOn } = evaluation
    const isDataEmpty = data.result.length === 0
    const wasFiring = lastRunAlert === 'firing' || lastRunAlert === 'still firing'

    if (alertOn === 'data') {
      if (isDataEmpty) {
        return wasFiring ? 'no longer firing' : 'not firing'
      } else {
        return wasFiring ? 'still firing' : 'firing'
      }
    }

    if (alertOn === 'noData') {
      if (isDataEmpty) {
        return wasFiring ? 'still firing' : 'firing'
      } else {
        return wasFiring ? 'no longer firing' : 'not firing'
      }
    }
  }
}
/**
   * Handles service events for monitors.
   *
   * @param {object} monitorsModel - The monitors model object.
   * @param {object} data - The data object received from the service event.
   * @param {string} event - The event type.
   * @returns {Promise} - A promise that resolves when the function is done.
   */
async function handleServiceEvents (monitorsModel, data, event) {
  const serviceName = data.path.split('/')[1] // ex : api/features -> features
  const activeEventMonitors = Object.values(monitorsModel.activeMonitors).filter(monitor => monitor.monitor.monitor.type === 'event' && monitor.monitor.monitor.trigger.includes(event))
  // Only get the monitors that are of type event and that have the event in their trigger
  for (const monitor of activeEventMonitors) {
    if (serviceName !== monitor.monitor.target.layerInfo.kanoService && serviceName !== monitor.monitor.zone.layerInfo.kanoService) {
      // if the service name is not the one we are looking for, we skip it
      continue
    }

    if (serviceName === 'features' && (data.layer !== monitor.monitor.target.layerInfo.layerId && data.layer !== monitor.monitor.zone.layerInfo.layerId)) {
      // if the service is "features" and the layers are not the ones we are looking for, we skip it
      continue
    }

    // get the element (target or zone) that corresponds to the event
    const dataElement = data.layer === monitor.monitor.target.layerInfo.layerId ? monitor.monitor.target : monitor.monitor.zone
    const dataFilter = unescape(dataElement.filter) ?? {}
    // if the data matches the filter, we run the monitor
    if (find([data], dataFilter).all().length > 0) {
      await runMonitor.bind(monitorsModel)(monitor.monitor)
    }
  }
}

/**
   * Runs a monitor and updates its status based on the evaluation of data.
   *
   * @param {Object} monitorObject - The monitor object containing the necessary information for running the monitor.
   * @returns {Promise<void>} - A promise that resolves once the monitor object is updated in the database.
   */
async function runMonitor (monitorObject) {
  this.app.logger.info(`Currently running ${Object.keys(this.activeMonitors).length} monitor(s)`)
  debug('Currently running %d monitor(s)', Object.keys(this.activeMonitors).length)

  // Create a deep copy of the monitor object and unescape it
  const escapedMonitorObject = unescape(_.cloneDeep(monitorObject))

  // Evaluate the monitor using the evaluate function
  const data = await this.evaluate(escapedMonitorObject)

  // Update the lastRun property of the monitor object with the unescaped lastRun value
  monitorObject.monitor.lastRun = escapedMonitorObject.monitor.lastRun

  // Update the layerInfos in case they were not present / updated
  if (escapedMonitorObject.zone.layerInfo) {
    monitorObject.zone.layerInfo = escapedMonitorObject.zone.layerInfo
  }
  if (escapedMonitorObject.target.layerInfo) {
    monitorObject.target.layerInfo = escapedMonitorObject.target.layerInfo
  }

  // Determine the firing status of the monitor based on the evaluation result, but only if the monitor is successful
  if (escapedMonitorObject.monitor.lastRun?.status?.success) {
    const alertStatus = this.determineFiringStatus(monitorObject, data)

    // Run actions based on the firing status
    if (alertStatus !== 'not firing') {
      await this.runActions(monitorObject, alertStatus, data.result)
    }
    monitorObject.monitor.lastRun.alert = alertStatus
  }

  // Update the monitor object
  monitorObject.monitor.lastRun.status = data.status
  monitorObject.monitor.lastRun.date = new Date()

  // Update the monitor object in the database
  await this.model.updateOne({ _id: monitorObject._id }, monitorObject)
}

export default monitorsModel
