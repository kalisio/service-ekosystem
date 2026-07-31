import AjvModule from 'ajv'
import addFormatsModule from 'ajv-formats'
import { validateCronExpression } from 'cron'
import _ from 'lodash'

const Ajv = AjvModule.default ?? AjvModule
const addFormats = addFormatsModule.default ?? addFormatsModule

const validActions = ['slack-webhook', 'custom-request', 'crisis-webhook', 'no-webhook']
const validMethods = ['get', 'post', 'put', 'delete']

const ajv = new Ajv({
  // Automatic coercion is off: it also converts the other way round (a number into a
  // string), which would let a numeric name or description through. The conversions we
  // do want are applied field by field in normalise().
  coerceTypes: false,
  useDefaults: true, // fill in the declared defaults
  // Collect everything, then report the most specific failure (see pickError):
  // reporting the first one would surface a missing top-level key rather than the
  // precise field the payload got wrong.
  allErrors: true,
  strict: false
})
addFormats(ajv)

/**
 * Check that a value is a usable cron expression.
 * @note validated with cron, the very library that schedules the monitors, so any
 * expression accepted here can effectively be scheduled.
 * @param {*} expression the value to check
 * @returns {Boolean} true when the expression can be scheduled
 */
function isValidCron (expression) {
  return validateCronExpression(expression).valid
}

// JSON Schema has no notion of a cron expression, so we add the keyword ourselves.
// It is used below as: { type: 'string', isCron: true }
ajv.addKeyword({
  keyword: 'isCron',
  type: 'string',
  schemaType: 'boolean',
  validate: (enabled, value) => !enabled || isValidCron(value),
  error: { message: 'must be a valid cron expression' }
})

/**
 * Normalise the payload before validation, so that values arriving as strings
 * (typically from a query string or a form) are still accepted:
 * - a numeric string becomes a number
 * - 'true'/'false' become booleans
 * - a headers/body that is not an object is replaced by an empty object
 * @param {Object} data the incoming payload, modified in place
 * @returns {Object} the same object
 */
function normalise (data) {
  if (!_.isObject(data)) return data

  const convert = (path, fn) => {
    const value = _.get(data, path)
    if (value !== undefined) _.set(data, path, fn(value))
  }
  const asNumber = (value) =>
    (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value)) ? Number(value) : value)
  const asBoolean = (value) => {
    if (typeof value !== 'string') return value
    const text = value.toLowerCase()
    return text === 'true' ? true : text === 'false' ? false : value
  }
  const asObject = (value) => (!value || typeof value !== 'object' ? {} : value)

  convert('monitor.enabled', asBoolean)
  convert('monitor.action.cooldown', asNumber)
  convert('monitor.evaluation.maxDistance', asNumber)
  convert('monitor.evaluation.minDistance', asNumber)
  convert('monitor.action.additionalProperties.headers', asObject)
  convert('monitor.action.additionalProperties.body', asObject)
  return data
}

/**
 * Remove everything the client may send but never owns: the database identifiers,
 * the timestamps and the values produced by the evaluation. Two fields are also
 * dropped when they cannot apply: a dryRun has no schedule, and a monitor that calls
 * no webhook has no url.
 * @param {Object} value the validated payload, modified in place
 * @returns {Object} the same object
 */
function stripGenerated (value) {
  if (!_.isObject(value)) return value
  delete value._id
  delete value.createdAt
  delete value.updatedAt
  if (_.isObject(value.target)) delete value.target.layerInfo
  if (_.isObject(value.zone)) delete value.zone.layerInfo
  if (_.isObject(value.monitor)) {
    delete value.monitor.lastRun
    // a dryRun has no schedule, so its trigger is not carried over
    if (value.monitor.type === 'dryRun') delete value.monitor.trigger
    // the url is meaningless when no webhook is called
    if (_.isObject(value.monitor.action) && value.monitor.action.type === 'no-webhook') {
      delete value.monitor.action.url
    }
  }
  return value
}

/**
 * Describe the first validation error as `{ message, details: [{ context }] }`,
 * the shape the validateMonitorStructure hook turns into a BadRequest
 * @param {Array} errors the errors reported by AJV
 * @returns {Object} the error description
 */
/**
 * Among all the failures reported, pick the one that describes the payload best:
 * the deepest field wins, so a wrong value is reported rather than the parent that
 * contains it. `not`/`if` come from the conditional branches and only say that a
 * combination is invalid, so they are kept as a last resort.
 * @param {Array} errors the errors reported by AJV
 * @returns {Object} the most specific one
 */
function pickError (errors) {
  // Depth of the field the error is reported on. A missing property does not count:
  // a wrong value two levels down is more precise than a sibling that is absent.
  const depthOf = (error) => error.instancePath.split('/').filter(Boolean).length
  const isVague = (error) => ['not', 'if', 'anyOf', 'oneOf'].includes(error.keyword)
  return errors.reduce((best, current) => {
    if (isVague(current) && !isVague(best)) return best
    if (!isVague(current) && isVague(best)) return current
    return depthOf(current) > depthOf(best) ? current : best
  })
}

function toError (errors, data) {
  if (!errors?.length) return { message: 'invalid payload', details: [{ context: {} }] }
  const first = pickError(errors)

  const path = first.instancePath.replace(/^\//, '').replace(/\//g, '.')
  const { keyword, params } = first
  const describe = (target) => {
    switch (keyword) {
      case 'required': return `"${target}.${params.missingProperty}" is required`
      case 'enum': return `"${target}" must be one of [${(params.allowedValues ?? []).join(', ')}]`
      case 'minimum': return `"${target}" must be greater than or equal to ${params.limit}`
      case 'maximum': return `"${target}" must be less than or equal to ${params.limit}`
      case 'minLength': return `"${target}" is not allowed to be empty`
      case 'type': return `"${target}" must be of type ${params.type}`
      case 'format': return `"${target}" must be a valid ${params.format}`
      case 'additionalProperties': return `"${target}.${params.additionalProperty}" is not allowed`
      case 'isCron': return `"${target}" must be a valid cron expression`
      default: return `"${target}" ${first.message}`
    }
  }

  let message
  const monitorType = _.get(data, 'monitor.type')
  const actionType = _.get(data, 'monitor.action.type')

  // A trigger that is present but the wrong shape is described against monitor.type.
  // A missing one is simply reported as required, like any other field.
  if (path.startsWith('monitor.trigger') && keyword !== 'required') {
    if (monitorType === 'cron') {
      message = keyword === 'isCron'
        ? 'if "monitor.type" is "cron","monitor.trigger" must be a valid cron expression'
        : 'if "monitor.type" is "cron","monitor.trigger" must be a string'
    } else if (monitorType === 'event') {
      // a failure on monitor.trigger itself is the wrong container type,
      // one on monitor.trigger.<n> is an element that is not a string
      message = path === 'monitor.trigger'
        ? 'if "monitor.type" is "event","monitor.trigger" must be an array'
        : 'if "monitor.type" is "event",all elements of "monitor.trigger" must be strings'
    }
  } else if (path.startsWith('monitor.action.additionalProperties') && actionType) {
    // historical spelling kept so the reported messages stay unchanged
    const target = path.replace('monitor.action.additionalProperties', 'monitor.action.aditionalProperties')
    message = `if "monitor.action.type" is "${actionType}", ${describe(target).replace(/^"/, '"')}`
  }

  if (!message) message = path ? describe(path) : (first.message ?? 'invalid payload')

  return { message, details: [{ context: { path, ...params } }] }
}

/**
 * Compile a schema into a `.validate(data) -> { value, error }` function: the payload
 * is normalised, validated, then cleaned of the server-generated fields.
 * @note AJV writes the defaults into the object it is given, so we work on a copy
 * @param {Object} schema the JSON schema to compile
 * @returns {Object} an object exposing `validate`
 */
function asValidator (schema) {
  const validate = ajv.compile(schema)
  return {
    validate (data) {
      const value = normalise(_.cloneDeep(data))
      if (!validate(value)) return { value, error: toError(validate.errors, value) }
      return { value: stripGenerated(value) }
    }
  }
}

// A layer the monitor watches. The target and the zone share this exact shape.
const endpoint = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1 },
    filter: { type: 'object' },
    layerInfo: {} // ignored, generated by the evaluation
  },
  required: ['name'],
  additionalProperties: false
}

const crisisWebhookProperties = {
  type: 'object',
  properties: {
    organisation: { type: 'string', minLength: 1 },
    token: { type: 'string', minLength: 1 },
    data: {
      type: 'object',
      properties: {
        template: { type: 'string', minLength: 1 },
        // free-form: they are forwarded to the crisis event as they are
        name: {},
        description: {}
      },
      required: ['template'],
      additionalProperties: false
    }
  },
  required: ['organisation', 'token', 'data'],
  additionalProperties: false
}

const customRequestProperties = {
  type: 'object',
  properties: {
    method: { enum: validMethods },
    // sent as-is with the request; anything that is not an object becomes {} (see normalise)
    headers: { default: {} },
    body: { default: {} }
  },
  required: ['method'],
  additionalProperties: false
}

// The action block: identical in all three schemas below.
// `additionalProperties` inside `properties` is a *field name*, not the JSON Schema keyword.
const action = {
  type: 'object',
  default: { type: 'no-webhook', cooldown: 60 },
  properties: {
    type: { enum: validActions, default: 'no-webhook' },
    cooldown: { type: 'number', minimum: 0, default: 60 },
    url: { type: 'string', format: 'uri' },
    additionalProperties: { type: 'object' }
  },
  additionalProperties: false,
  allOf: [
    // a url is required - and only validated - when a webhook is actually called
    {
      if: { properties: { type: { const: 'no-webhook' } }, required: ['type'] },
      then: {},
      else: { required: ['url'] }
    },
    // additionalProperties is required and typed for these two, forbidden for the others
    {
      if: { properties: { type: { const: 'crisis-webhook' } }, required: ['type'] },
      then: { required: ['additionalProperties'], properties: { additionalProperties: crisisWebhookProperties } }
    },
    {
      if: { properties: { type: { const: 'custom-request' } }, required: ['type'] },
      then: { required: ['additionalProperties'], properties: { additionalProperties: customRequestProperties } }
    },
    {
      if: { properties: { type: { enum: ['no-webhook', 'slack-webhook'] } }, required: ['type'] },
      then: { not: { required: ['additionalProperties'] } }
    }
  ]
}

// What a monitor is triggered by, which depends on its type. Shared by the three schemas.
const triggerRules = [
  {
    // cron: a string holding a valid cron expression
    if: { properties: { type: { const: 'cron' } }, required: ['type'] },
    then: { required: ['name', 'trigger'], properties: { trigger: { type: 'string', isCron: true } } }
  },
  {
    // event: an array of event names
    if: { properties: { type: { const: 'event' } }, required: ['type'] },
    then: { required: ['name', 'trigger'], properties: { trigger: { type: 'array', items: { type: 'string' } } } }
  }
  // dryRun: name and trigger are optional and the trigger is not validated
]

/**
 * Schema for creating a monitor (POST method)
 * - monitor.type can be cron, event or dryRun
 * - depending on the type, monitor.trigger has different requirements
 * - a dryRun is never persisted, so name and trigger are optional for it
 */
const forCreation = asValidator({
  type: 'object',
  properties: {
    _id: {}, // ignored, generated by the database
    createdAt: {}, // ignored, generated by the database
    updatedAt: {}, // ignored, generated by the database
    target: endpoint,
    zone: endpoint,
    monitor: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1 },
        description: { type: 'string', default: '' },
        type: { enum: ['cron', 'event', 'dryRun'] },
        enabled: { type: 'boolean', default: true },
        trigger: {},
        lastRun: {}, // ignored, generated by the evaluation
        evaluation: {
          type: 'object',
          properties: {
            alertOn: { enum: ['noData', 'data'], default: 'data' },
            type: { type: 'string', minLength: 1 },
            maxDistance: { type: 'number', minimum: 0 },
            minDistance: { type: 'number', minimum: 0 }
          },
          required: ['type'],
          additionalProperties: false
        },
        action
      },
      required: ['type', 'evaluation'],
      additionalProperties: false,
      allOf: triggerRules
    }
  },
  required: ['target', 'zone', 'monitor'],
  additionalProperties: false
})

/**
 * Schema for updating a monitor (PUT method)
 * - monitor.type can be cron or event (not dryRun)
 * - being a full update nothing is inherited, so name and enabled must be explicit
 */
const forUpdate = asValidator({
  type: 'object',
  properties: {
    _id: {},
    createdAt: {},
    updatedAt: {},
    target: endpoint,
    zone: endpoint,
    monitor: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1 },
        description: { type: 'string', default: '' },
        type: { enum: ['cron', 'event'] },
        enabled: { type: 'boolean' },
        trigger: {},
        lastRun: {},
        evaluation: {
          type: 'object',
          properties: {
            alertOn: { enum: ['noData', 'data'], default: 'data' },
            type: { type: 'string', minLength: 1 },
            maxDistance: { type: 'number', minimum: 0 },
            minDistance: { type: 'number', minimum: 0 }
          },
          required: ['type'],
          additionalProperties: false
        },
        action
      },
      required: ['type', 'evaluation', 'enabled', 'name'],
      additionalProperties: false,
      allOf: triggerRules
    }
  },
  required: ['target', 'zone', 'monitor'],
  additionalProperties: false
})

/**
 * Schema for patching a monitor (PATCH method)
 * Same rules as an update, except nothing is required: whatever the payload leaves out
 * is inherited from the stored monitor before validation (see validatePatchSchema).
 */
const forPatch = asValidator({
  type: 'object',
  properties: {
    _id: {},
    createdAt: {},
    updatedAt: {},
    target: endpoint,
    zone: endpoint,
    monitor: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1 },
        description: { type: 'string', default: '' },
        type: { enum: ['cron', 'event'] },
        enabled: { type: 'boolean' },
        trigger: {},
        lastRun: {},
        evaluation: {
          type: 'object',
          properties: {
            alertOn: { enum: ['noData', 'data'], default: 'data' },
            type: { type: 'string', minLength: 1 },
            maxDistance: { type: 'number', minimum: 0 },
            minDistance: { type: 'number', minimum: 0 }
          },
          required: ['type'],
          additionalProperties: false
        },
        action
      },
      required: ['type', 'evaluation'],
      additionalProperties: false,
      allOf: triggerRules
    }
  },
  required: ['target', 'zone', 'monitor'],
  additionalProperties: false
})

/**
 * Validate a patch against the monitor being modified, using its current values as defaults
 * @param {Object} currentMonitor the monitor as currently stored
 * @param {Object} newData the partial payload
 * @returns {Object} `{ value, error }`
 */
function validatePatchSchema (currentMonitor, newData) {
  // type and trigger depend on each other: if only one is supplied we still need the
  // other to validate the pair, so both fall back to the currently stored value
  _.set(newData, 'monitor.type', _.get(newData, 'monitor.type', currentMonitor.monitor.type))
  _.set(newData, 'monitor.trigger', _.get(newData, 'monitor.trigger', currentMonitor.monitor.trigger))

  const inherited = _.cloneDeep(newData)
  const current = _.cloneDeep(currentMonitor)
  const inherit = (owner, source, keys) => {
    for (const key of keys) if (owner[key] === undefined) owner[key] = source[key]
  }

  // A section left out entirely is taken from the stored monitor. A section that *is*
  // supplied only inherits its name: this is what lets a patch drop a filter by
  // sending the target without one.
  for (const section of ['target', 'zone']) {
    if (inherited[section] === undefined) inherited[section] = current[section]
    else inherit(inherited[section], current[section], ['name'])
  }

  // The monitor inherits field by field, so a patch can touch one setting and leave
  // the rest untouched. evaluation and action are inherited whole, never merged.
  if (inherited.monitor === undefined) inherited.monitor = current.monitor
  else inherit(inherited.monitor, current.monitor, ['name', 'description', 'enabled', 'evaluation', 'action'])

  stripGenerated(inherited)

  return forPatch.validate(inherited)
}

export default {
  forCreation,
  forUpdate,
  validatePatchSchema
}
