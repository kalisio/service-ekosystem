import Joi from 'joi'
import cron from 'node-cron'
import _ from 'lodash'

const validActions = ['slack-webhook', 'custom-request', 'crisis-webhook', 'no-webhook']

/**
 * Custom validation function to insure that the trigger is valid based on the monitor type
 * @param {*} value
 * @param {*} helpers
 * @returns the value if it is valid, otherwise a joi error
*/
function validateTrigger (value, helpers) {
  const type = helpers.state.ancestors[0].type
  switch (type) {
    case 'cron':
      // the trigger must be a string, and a valid cron expression
      if (typeof value !== 'string') {
        return helpers.error('any.invalid', { type, value, message: 'if "monitor.type" is "cron","monitor.trigger" must be a string' })
      }
      if (!cron.validate(value)) {
        return helpers.error('any.invalid', { type, value, message: 'if "monitor.type" is "cron","monitor.trigger" must be a valid cron expression' })
      }
      return value

    case 'event':
      // the trigger must be an array, and all elements must be strings
      if (!Array.isArray(value)) {
        return helpers.error('any.invalid', { type, value, message: 'if "monitor.type" is "event","monitor.trigger" must be an array' })
      }
      if (!value.every((element) => typeof element === 'string')) {
        return helpers.error('any.invalid', { type, value, message: 'if "monitor.type" is "event",all elements of "monitor.trigger" must be strings' })
      }
      return value
  }
}

/**
 * Custom validation function to insure that the additional properties are valid based on the monitor action type
 * @param {*} value
 * @param {*} helpers
 * @returns the value if it is valid, otherwise a joi error
 */
function validateAdditionalProperties (value, helpers) {
  const type = helpers.state.ancestors[0].type
  switch (type) {
    case 'crisis-webhook':
      // the only field allowed are [organisation, token, data] and in data [template,name,description]
      if (!value.organisation || typeof value.organisation !== 'string') { return helpers.error('any.invalid', { type, value, message: 'if "monitor.action.type" is "crisis-webhook", "monitor.action.aditionalProperties.organisation" is required' }) }
      if (!value.token || typeof value.token !== 'string') { return helpers.error('any.invalid', { type, value, message: 'if "monitor.action.type" is "crisis-webhook", "monitor.action.aditionalProperties.token" is required' }) }
      if (!value.data || typeof value.data !== 'object') { return helpers.error('any.invalid', { type, value, message: 'if "monitor.action.type" is "crisis-webhook", "monitor.action.aditionalProperties.data" is required' }) }
      if (!value.data.template || typeof value.data.template !== 'string') { return helpers.error('any.invalid', { type, value, message: 'if "monitor.action.type" is "crisis-webhook", "monitor.action.aditionalProperties.data.template" is required' }) }

      // check recursively the fields, only [organisation, token, data, template, name, description] are allowed
      for (const key in value) {
        if (!['organisation', 'token', 'data'].includes(key)) {
          return helpers.error('any.invalid', { type, value, message: 'if "monitor.action.type" is "crisis-webhook", "monitor.action.aditionalProperties.data.' + key + '" is not allowed' })
        }
        if (key === 'data') {
          for (const dataKey in value.data) {
            if (!['template', 'name', 'description'].includes(dataKey)) {
              return helpers.error('any.invalid', { type, value, message: 'if "monitor.action.type" is "crisis-webhook", "monitor.action.aditionalProperties.data.' + dataKey + '" is not allowed' })
            }
          }
        }
      }

      return value
    case 'custom-request':

      // if the method is not defined, should be required
      if (!value.method) { return helpers.error('any.invalid', { type, value, message: 'if "monitor.action.type" is "custom-request", "monitor.action.aditionalProperties.method" is required' }) }

      // if the method is not one of [get, post, put, delete]
      if (['get', 'post', 'put', 'delete'].indexOf(value.method) === -1) { return helpers.error('any.invalid', { type, value, message: 'if "monitor.action.type" is "custom-request", "monitor.action.aditionalProperties.method" must be one of [get, post, put, delete]' }) }

      // if the headers are not defined, should be an empty object
      if (!value.headers || typeof value.headers !== 'object') {
        value.headers = {}
      }
      // if the body is not defined, should be an empty object
      if (!value.body || typeof value.body !== 'object') {
        value.body = {}
      }
      // check recursively the fields, only [method, headers, body] are allowed
      for (const key in value) {
        if (!['method', 'headers', 'body'].includes(key)) {
          return helpers.error('any.invalid', { type, value, message: 'if "monitor.action.type" is "custom-request", "monitor.action.aditionalProperties.data.' + key + '" is not allowed' })
        }
      }
      return value
  }
}

/**
 * Schema for creating a monitor (POST method)
 * - monitor.type can be cron, event or dryRun
 * - depending on the type, monitor.trigger has different requirements
 * - depending on the type, some fields are required or optional
 */
const forCreation = Joi.object({
  _id: Joi.any().strip(), // ingored, will be generated by the database
  createdAt: Joi.any().strip(), // ignored, will be generated by the database
  updatedAt: Joi.any().strip(), // ignored, will be generated by the database

  target: Joi.object({
    name: Joi.string().required(),
    filter: Joi.object().optional(),
    layerInfo: Joi.any().strip() // ignored, will be generated by the evaluation
  }).required(),

  zone: Joi.object({
    name: Joi.string().required(),
    filter: Joi.object().optional(),
    layerInfo: Joi.any().strip() // ignored, will be generated by the evaluation
  }).required(),

  monitor: Joi.object({
    name: Joi.string().when('type', { is: 'dryRun', then: Joi.optional(), otherwise: Joi.required() }),
    description: Joi.string().empty('').default(''),
    type: Joi.string().valid('cron', 'event', 'dryRun').required(),
    enabled: Joi.boolean().default(true),
    // if the type is cron, trigger is required and needs to be a string that is a valid cron expression
    // if the type is event, trigger is required and needs to be an array of strings
    // if the type is dryRun, trigger is optional (not needed)
    trigger: Joi.custom(validateTrigger)
      .when('type', {
        is: 'dryRun',
        then: Joi.optional(),
        otherwise: Joi.required()
      }),

    lastRun: Joi.any().strip(),

    evaluation: Joi.object({
      alertOn: Joi.string().valid('noData', 'data').default('data'),
      type: Joi.string().required(),
      maxDistance: Joi.number().min(0).optional(),
      minDistance: Joi.number().min(0).optional()
    }).required(),

    action: Joi.object({
      type: Joi.string().valid(...validActions).default('no-webhook'),
      cooldown: Joi.number().min(0).default(60),
      url: Joi.string().uri().when('type', {
        is: Joi.valid('no-webhook'),
        then: Joi.any().strip(),
        otherwise: Joi.required()
      }),

      additionalProperties: Joi.object().when('type', {
        is: Joi.valid('crisis-webhook', 'custom-request'),
        then: Joi.custom(validateAdditionalProperties).required(),
        otherwise: Joi.forbidden()
      })

    }).default({ type: 'no-webhook', cooldown: 60 })
  }).required()
})

/**
 * Schema for updating a monitor (PUT method)
 * - monitor.type can be cron or event (not dryRun)
 */
const forUpdate = Joi.object({
  _id: Joi.any().strip(), // ingored, will be generated by the database
  createdAt: Joi.any().strip(), // ignored, will be generated by the database
  updatedAt: Joi.any().strip(), // ignored, will be generated by the database

  target: Joi.object({
    name: Joi.string().required(),
    filter: Joi.object().optional(),
    layerInfo: Joi.any().strip() // ignored, will be generated by the evaluation
  }).required(),

  zone: Joi.object({
    name: Joi.string().required(),
    filter: Joi.object().optional(),
    layerInfo: Joi.any().strip() // ignored, will be generated by the evaluation
  }).required(),

  monitor: Joi.object({
    name: Joi.string().required(),
    description: Joi.string().empty('').default(''),
    type: Joi.string().valid('cron', 'event').required(),
    // Since this is an update(PUT) method, we won't accept default values
    enabled: Joi.boolean().required(),
    trigger: Joi.custom(validateTrigger).required(),
    lastRun: Joi.any().strip(), // ignored, will be generated by the evaluation

    evaluation: Joi.object({
      alertOn: Joi.string().valid('noData', 'data').default('data'),
      type: Joi.string().required(),
      maxDistance: Joi.number().min(0).optional(),
      minDistance: Joi.number().min(0).optional() // Change minDistance validation to not be less than 0
    }).required(),

    action: Joi.object({
      type: Joi.string().valid(...validActions).default('no-webhook'),
      cooldown: Joi.number().min(0).default(60),
      url: Joi.string().uri().when('type', {
        is: Joi.valid('no-webhook'),
        then: Joi.any().strip(),
        otherwise: Joi.required()
      }),

      additionalProperties: Joi.object().when('type', {
        is: Joi.valid('crisis-webhook', 'custom-request'),
        then: Joi.custom(validateAdditionalProperties).required(),
        otherwise: Joi.forbidden()
      })

    }).default({ type: 'no-webhook', cooldown: 60 })
  }).required()
})

/**
 * validate a patch schema based on the current monitor object defining default values
 * @param {*} currentMonitor
 * @returns the validation result
 */
function validatePatchSchema (currentMonitor, newData) {
  // We define the default values for type and trigger since they are dependent on each other
  // and we need verify that if we change the type, the trigger is compatible
  _.set(newData, 'monitor.type', _.get(newData, 'monitor.type', currentMonitor.monitor.type))
  _.set(newData, 'monitor.trigger', _.get(newData, 'monitor.trigger', currentMonitor.monitor.trigger))

  const schema = Joi.object({
    _id: Joi.any().strip(), // ingored, will be generated by the database
    createdAt: Joi.any().strip(), // ingored, will be generated by the database
    updatedAt: Joi.any().strip(), // ingored, will be generated by the database

    target: Joi.object({
      name: Joi.string().default(currentMonitor.target.name),
      filter: Joi.object().optional(), // we can remove the filter if needed
      layerInfo: Joi.any().strip() // ignored, will be generated by the evaluation
    }).default(currentMonitor.target),

    zone: Joi.object({
      name: Joi.string().default(currentMonitor.zone.name),
      filter: Joi.object().optional(), // we can remove the filter if needed
      layerInfo: Joi.any().strip() // ignored, will be generated by the evaluation
    }).default(currentMonitor.zone),

    monitor: Joi.object({
      name: Joi.string().default(currentMonitor.monitor.name),
      description: Joi.string().empty('').default(currentMonitor.monitor.description),
      type: Joi.string().valid('cron', 'event').required(),
      trigger: Joi.custom(validateTrigger).required(),
      enabled: Joi.boolean().default(currentMonitor.monitor.enabled),
      lastRun: Joi.any().strip(), // ignored, will be generated by the evaluation

      evaluation: Joi.object({
        alertOn: Joi.string().valid('noData', 'data').default(currentMonitor.monitor.evaluation.alertOn),
        type: Joi.string().default(currentMonitor.monitor.evaluation.type),
        maxDistance: Joi.number().min(0).optional(),
        minDistance: Joi.number().min(0).optional()
      }).default(currentMonitor.monitor.evaluation),

      action: Joi.object({
        type: Joi.string().valid(...validActions).default(_.get(currentMonitor, 'monitor.action.type', 'no-webhook')),
        cooldown: Joi.number().min(0).default(_.get(currentMonitor, 'monitor.action.cooldown', 60)),
        url: Joi.string().uri().when('type', {
          is: Joi.valid('no-webhook'),
          then: Joi.any().strip(),
          otherwise: Joi.required()
        }),
        additionalProperties: Joi.object().when('type', {
          is: Joi.valid('crisis-webhook', 'custom-request'),
          then: Joi.custom(validateAdditionalProperties).required(),
          otherwise: Joi.forbidden()
        })
      }).default(currentMonitor.monitor.action)

    }).default(currentMonitor.monitor)
  })
  return schema.validate(newData)
}

export default {
  forCreation,
  forUpdate,
  validatePatchSchema
}
