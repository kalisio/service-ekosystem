import _ from 'lodash'
import { escape, unescape } from '../common/mongo-escape.js'
import { generateObjectId, isObjectId } from '../common/helper.js'
import monitorsModel from '../models/monitors.model.js'
import ferrors from '@feathersjs/errors'
import monitorSchema from '../services/monitors/monitors.schema.js'

/**
 * Parse the query object and convert the values to the correct type
 * @param {Hook} hook Hook object
 * @returns {Promise<Hook>}
 */
export function parseQuery (hook) {
  const query = _.get(hook, 'params.query', {})
  const parsedValues = {}
  Object.entries(query).forEach(([key, value]) => {
    parsedValues[key] = convertValues(value)
  })
  _.set(hook, 'params.query', parsedValues)
  return hook
}

/**
 * check if a monitor with the same name already exists
 * @param {Hook} hook Hook object
 * @returns {Promise<Hook>}
 * @throws {Conflict} if the monitor already exists
*/
export async function checkIfNameAlreadyExists (hook) {
  const monitorName = _.get(hook, 'data.monitor.name')

  // Get all the monitors with the same name
  let OtherMonitors = await hook.service.find({ query: { 'monitor.name': monitorName } })
  // Remove the current monitor from the list
  OtherMonitors = OtherMonitors.filter((monitor) => monitor._id.toString() !== hook.id.toString())

  // If there are other monitors with the same name, we throw an error
  if (OtherMonitors.length > 0) {
    throw new ferrors.Conflict('Monitor with the same name already exists', { monitor: monitorName })
  }

  return hook
}
/**
 * Checks if a monitor exists based on the identifier provided in the hook
 *
 * @param {Hook} hook Hook object
 * @returns {Promise<Hook>}
 * @throws {BadRequest} - Throws a BadRequest error if the identifier is not a valid ObjectId.
 * @throws {NotFound} - Throws a NotFound error if the monitor doesn't exist.
 */
export async function checkIfMonitorExists (hook) {
  if (!isObjectId(hook.id)) {
    throw new ferrors.BadRequest('The identifier must be a valid ObjectId', { id: hook.id })
  }
  // will throw a not found error if the monitor doesn't exist
  await hook.service.get(hook.id)
  return hook
}

/**
 * Validate the structure of the monitor object against its JSON schema
 * @param {Hook} hook Hook object
 * @returns {Promise<Hook>}
 * @throws {BadRequest} if the monitor object is not valid
*/
export async function validateMonitorStructure (hook) {
  let validationResult
  switch (hook.event) {
    case 'created': {
      validationResult = monitorSchema.forCreation.validate(hook.data)
      hook.id = generateObjectId()
      break
    }

    case 'updated': {
      validationResult = monitorSchema.forUpdate.validate(hook.data)
      break
    }

    case 'patched': {
      const currentMonitor = await hook.service.get(hook.id)
      validationResult = monitorSchema.validatePatchSchema(currentMonitor, hook.data)
      break
    }
  }

  if (validationResult.error) {
    const data = validationResult.error.details[0].context || {}
    throw new ferrors.BadRequest(validationResult.error.message, data)
  }

  hook.data = validationResult.value
  hook.data._id = hook.id

  return hook
}

// Stamp the creation and modification dates. The database driver doesn't manage them,
// so they're set here: createdAt only on creation, updatedAt on every write.
export function setTimestamps (hook) {
  const now = new Date()
  if (hook.method === 'create') hook.data.createdAt = now
  hook.data.updatedAt = now
  return hook
}

/**
 * Escape the data object to be saved in the mongoDB database
 * @param {Hook} hook Hook object
 * @returns {Promise<Hook>}
 * Ensure any input is properly escaped. Where needed $ and . are replaced with ＄ and ．, respectively.
   If input is an object, all keys are escaped. If input is not an object but a string it is escaped as well. Otherwise return the original value. If input is a function or a symbol an error is raised.
 */
export function escapeToBSON (hook) {
  const data = _.get(hook, 'data', {})
  hook.data = escape(data)
  return hook
}

/**
 * Unescape the data object to be saved in the mongoDB database
 * @param {Hook} hook Hook object
 * @returns {Promise<Hook>}
 * Ensure any input is properly unescaped. Where needed ＄ and ． are replaced with $ and ., respectively.
   If input is an object, all keys are unescaped. If input is not an object but a string it is unescaped as well. Otherwise return the original value. If input is a function or a symbol an error is raised.
 */
export function unescapeFromBSON (hook) {
  if (hook.result.data) {
    hook.result.data = hook.result.data.map((data) => unescape(data))
  } else {
    hook.result = unescape(hook.result)
  }
  return hook
}
/**
 * Run the evaluation of the monitor
 * @param {Hook} hook Hook object
 * @returns {Promise<Hook>}
 * @note if the monitor is a dryRun, we return the result of the evaluation
 * @throws will throw an error if the evaluation fails
*/
export async function runEvaluation (hook) {
  const monitorObject = hook.data

  // we use the method from the model to evaluate the monitor
  // we set the second parameter (throwError) to true to throw an error if the monitor is not valid
  const result = await monitorsModel.evaluate(monitorObject, true)
  const alert = monitorsModel.determineFiringStatus(monitorObject, result)
  monitorObject.monitor.lastRun = {
    date: new Date(),
    lastActionRun: _.get(monitorObject, 'monitor.lastRun.lastActionRun', 0),
    alert,
    status: result.status
  }

  // if the monitor is a dryRun, we return the result of the evaluation
  if (monitorObject.monitor.type === 'dryRun') {
    // we return the object that should be saved and the result of the evaluation
    hook.result = { monitorObject, result }
  }
  return hook
}

/**
 * Start the monitor if it is enabled
 * @param {Hook} hook Hook object
 * @returns {Promise<Hook>}
 */
export async function startMonitor (hook) {
  if (hook.data.monitor.enabled && hook.data.monitor.type !== 'dryRun') {
    await monitorsModel.startMonitor(hook.data)
  }
  return hook
}

/**
 * Stop the monitor if it is enabled
 * @param {Hook} hook Hook object
 * @returns {Promise<Hook>}
 */
export function stopMonitor (hook) {
  if (Array.isArray(hook.result)) {
    hook.result.forEach((result) => {
      if ((hook.event === 'removed' || ['patch', 'update'].includes(hook.method)) && result.monitor?.enabled) {
        monitorsModel.stopMonitor(result)
      }
    })
  } else if (hook.event === 'removed' && hook.result.monitor?.enabled) {
    monitorsModel.stopMonitor(hook.result)
  } else if (['patch', 'update'].includes(hook.method) && hook.data.monitor?.enabled) {
    monitorsModel.stopMonitor(hook.data)
  }
  return hook
}

/**
 * stop the old monitor and start the new one (if it is enabled) after an update
 * @param {Hook} hook Hook object
 * @returns {Promise<Hook>}
 */
export async function resetMonitor (hook) {
  const currentMonitor = await hook.service.get(hook.id)
  if (currentMonitor.monitor.enabled) {
    monitorsModel.stopMonitor(currentMonitor)
  }
  if (hook.data.monitor.enabled) {
    await monitorsModel.startMonitor(hook.data)
  }
  return hook
}

/**
 * Convert the values to the correct type (boolean, number, etc.)
 * @param {any} value The value to convert
 * @returns {any} The value with the correct type
 */
function convertValues (value) {
  if (value === 'true') {
    return true
  } else if (value === 'false') {
    return false
  } else if (!isNaN(value)) {
    return parseFloat(value)
  } else if (Array.isArray(value)) {
    // we convert each element of the array
    return value.map((element) => convertValues(element))
  } else if (typeof value === 'object' && !Array.isArray(value)) {
    return parseQuery(value)
  } else if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/.test(value)) {
    return new Date(value)
  } else if (value === 'null') {
    return null
  } else if (value === 'undefined') {
    return undefined
  } else {
    return value
  }
}
