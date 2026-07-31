import { describe, it, expect } from 'vitest'
import monitorSchema from '../src/services/monitors/monitors.schema.js'

// Joi reports `{ value, error }`; expose it under a single shape for the assertions below
const adapt = (schema) => ({
  safeParse: (data) => {
    const { value, error } = schema.validate(data)
    return { success: !error, data: value, error }
  }
})

const forCreation = adapt(monitorSchema.forCreation)
const forUpdate = adapt(monitorSchema.forUpdate)
const validatePatchSchema = (currentMonitor, newData) => {
  const { value, error } = monitorSchema.validatePatchSchema(currentMonitor, newData)
  return { success: !error, data: value, error }
}

// Minimal valid payloads, used as a base and then mutated per test
const cronMonitor = () => ({
  target: { name: 'targetLayer' },
  zone: { name: 'zoneLayer' },
  monitor: {
    name: 'my-monitor',
    type: 'cron',
    trigger: '*/5 * * * *',
    evaluation: { type: 'intersects' }
  }
})

const eventMonitor = () => ({
  target: { name: 'targetLayer' },
  zone: { name: 'zoneLayer' },
  monitor: {
    name: 'my-monitor',
    type: 'event',
    trigger: ['created', 'patched'],
    evaluation: { type: 'intersects' }
  }
})

describe('forCreation - required fields', () => {
  it('accepts a minimal valid cron monitor', () => {
    const result = forCreation.safeParse(cronMonitor())
    expect(result.success).toBe(true)
  })

  it('rejects a missing target.name', () => {
    const data = cronMonitor()
    delete data.target.name
    expect(forCreation.safeParse(data).success).toBe(false)
  })

  it('rejects a missing zone.name', () => {
    const data = cronMonitor()
    delete data.zone.name
    expect(forCreation.safeParse(data).success).toBe(false)
  })

  it('rejects a missing monitor.evaluation', () => {
    const data = cronMonitor()
    delete data.monitor.evaluation
    expect(forCreation.safeParse(data).success).toBe(false)
  })

  it('rejects a missing evaluation.type', () => {
    const data = cronMonitor()
    delete data.monitor.evaluation.type
    expect(forCreation.safeParse(data).success).toBe(false)
  })
})

describe('forCreation - monitor.type', () => {
  it('rejects an unknown monitor type', () => {
    const data = cronMonitor()
    data.monitor.type = 'bogus'
    expect(forCreation.safeParse(data).success).toBe(false)
  })

  it('accepts cron, event and dryRun', () => {
    expect(forCreation.safeParse(cronMonitor()).success).toBe(true)
    expect(forCreation.safeParse(eventMonitor()).success).toBe(true)
    const dry = cronMonitor()
    dry.monitor.type = 'dryRun'
    expect(forCreation.safeParse(dry).success).toBe(true)
  })
})

describe('forCreation - trigger validation', () => {
  it('accepts a valid cron expression', () => {
    expect(forCreation.safeParse(cronMonitor()).success).toBe(true)
  })

  it('rejects an invalid cron expression', () => {
    const data = cronMonitor()
    data.monitor.trigger = 'not a cron expression'
    expect(forCreation.safeParse(data).success).toBe(false)
  })

  it('rejects a non-string trigger for a cron monitor', () => {
    const data = cronMonitor()
    data.monitor.trigger = ['created']
    expect(forCreation.safeParse(data).success).toBe(false)
  })

  it('accepts an array of event names for an event monitor', () => {
    expect(forCreation.safeParse(eventMonitor()).success).toBe(true)
  })

  it('rejects a string trigger for an event monitor', () => {
    const data = eventMonitor()
    data.monitor.trigger = 'created'
    expect(forCreation.safeParse(data).success).toBe(false)
  })

  it('rejects an array containing non-strings for an event monitor', () => {
    const data = eventMonitor()
    data.monitor.trigger = ['created', 42]
    expect(forCreation.safeParse(data).success).toBe(false)
  })
})

describe('forCreation - dryRun relaxations', () => {
  it('allows a dryRun monitor with no name and no trigger', () => {
    const data = cronMonitor()
    data.monitor.type = 'dryRun'
    delete data.monitor.name
    delete data.monitor.trigger
    expect(forCreation.safeParse(data).success).toBe(true)
  })

  it('still requires a name for non-dryRun monitors', () => {
    const data = cronMonitor()
    delete data.monitor.name
    expect(forCreation.safeParse(data).success).toBe(false)
  })

  it('still requires a trigger for non-dryRun monitors', () => {
    const data = cronMonitor()
    delete data.monitor.trigger
    expect(forCreation.safeParse(data).success).toBe(false)
  })
})

describe('forCreation - defaults', () => {
  it('applies defaults for enabled, description, alertOn and action', () => {
    const result = forCreation.safeParse(cronMonitor())
    expect(result.success).toBe(true)
    expect(result.data.monitor.enabled).toBe(true)
    expect(result.data.monitor.description).toBe('')
    expect(result.data.monitor.evaluation.alertOn).toBe('data')
    expect(result.data.monitor.action).toEqual({ type: 'no-webhook', cooldown: 60 })
  })

  it('does not override values that were provided', () => {
    const data = cronMonitor()
    data.monitor.enabled = false
    data.monitor.description = 'hello'
    data.monitor.evaluation.alertOn = 'noData'
    const result = forCreation.safeParse(data)
    expect(result.data.monitor.enabled).toBe(false)
    expect(result.data.monitor.description).toBe('hello')
    expect(result.data.monitor.evaluation.alertOn).toBe('noData')
  })

  it('rejects an unknown alertOn value', () => {
    const data = cronMonitor()
    data.monitor.evaluation.alertOn = 'sometimes'
    expect(forCreation.safeParse(data).success).toBe(false)
  })
})

describe('forCreation - stripped (server-generated) fields', () => {
  it('strips _id, createdAt, updatedAt, lastRun and layerInfo', () => {
    const data = cronMonitor()
    data._id = 'client-supplied'
    data.createdAt = 'client-supplied'
    data.updatedAt = 'client-supplied'
    data.monitor.lastRun = { alert: 'firing' }
    data.target.layerInfo = { kanoService: 'hacked' }
    data.zone.layerInfo = { kanoService: 'hacked' }

    const result = forCreation.safeParse(data)
    expect(result.success).toBe(true)
    expect(result.data._id).toBeUndefined()
    expect(result.data.createdAt).toBeUndefined()
    expect(result.data.updatedAt).toBeUndefined()
    expect(result.data.monitor.lastRun).toBeUndefined()
    expect(result.data.target.layerInfo).toBeUndefined()
    expect(result.data.zone.layerInfo).toBeUndefined()
  })

  it('preserves the target/zone filter objects as-is', () => {
    const data = cronMonitor()
    data.target.filter = { 'properties.deviceId': { $gt: 10 } }
    data.zone.filter = {}
    const result = forCreation.safeParse(data)
    expect(result.success).toBe(true)
    expect(result.data.target.filter).toEqual({ 'properties.deviceId': { $gt: 10 } })
    expect(result.data.zone.filter).toEqual({})
  })
})

describe('forCreation - evaluation distances', () => {
  it('accepts non-negative distances', () => {
    const data = cronMonitor()
    data.monitor.evaluation.maxDistance = 100
    data.monitor.evaluation.minDistance = 0
    expect(forCreation.safeParse(data).success).toBe(true)
  })

  it('rejects a negative maxDistance', () => {
    const data = cronMonitor()
    data.monitor.evaluation.maxDistance = -1
    expect(forCreation.safeParse(data).success).toBe(false)
  })

  it('rejects a negative minDistance', () => {
    const data = cronMonitor()
    data.monitor.evaluation.minDistance = -5
    expect(forCreation.safeParse(data).success).toBe(false)
  })
})

describe('forCreation - action', () => {
  it('rejects an unknown action type', () => {
    const data = cronMonitor()
    data.monitor.action = { type: 'carrier-pigeon' }
    expect(forCreation.safeParse(data).success).toBe(false)
  })

  it('requires a url for webhook actions', () => {
    const data = cronMonitor()
    data.monitor.action = { type: 'slack-webhook' }
    expect(forCreation.safeParse(data).success).toBe(false)
  })

  it('accepts a slack-webhook with a url', () => {
    const data = cronMonitor()
    data.monitor.action = { type: 'slack-webhook', url: 'https://hooks.slack.com/x' }
    expect(forCreation.safeParse(data).success).toBe(true)
  })

  it('strips the url for a no-webhook action', () => {
    const data = cronMonitor()
    data.monitor.action = { type: 'no-webhook', url: 'https://example.com' }
    const result = forCreation.safeParse(data)
    expect(result.success).toBe(true)
    expect(result.data.monitor.action.url).toBeUndefined()
  })

  it('rejects a negative cooldown', () => {
    const data = cronMonitor()
    data.monitor.action = { type: 'no-webhook', cooldown: -1 }
    expect(forCreation.safeParse(data).success).toBe(false)
  })

  it('forbids additionalProperties on actions that do not accept them', () => {
    const data = cronMonitor()
    data.monitor.action = {
      type: 'slack-webhook',
      url: 'https://hooks.slack.com/x',
      additionalProperties: { anything: true }
    }
    expect(forCreation.safeParse(data).success).toBe(false)
  })
})

describe('forCreation - crisis-webhook additionalProperties', () => {
  const crisisAction = (additionalProperties) => {
    const data = cronMonitor()
    data.monitor.action = {
      type: 'crisis-webhook',
      url: 'https://crisis.example.com',
      additionalProperties
    }
    return data
  }

  const validProps = () => ({
    organisation: 'kalisio',
    token: 'secret-token',
    data: { template: 'my-template' }
  })

  it('accepts valid crisis-webhook properties', () => {
    expect(forCreation.safeParse(crisisAction(validProps())).success).toBe(true)
  })

  it('requires additionalProperties to be present', () => {
    const data = cronMonitor()
    data.monitor.action = { type: 'crisis-webhook', url: 'https://crisis.example.com' }
    expect(forCreation.safeParse(data).success).toBe(false)
  })

  it('requires organisation', () => {
    const props = validProps()
    delete props.organisation
    expect(forCreation.safeParse(crisisAction(props)).success).toBe(false)
  })

  it('requires token', () => {
    const props = validProps()
    delete props.token
    expect(forCreation.safeParse(crisisAction(props)).success).toBe(false)
  })

  it('requires data.template', () => {
    const props = validProps()
    delete props.data.template
    expect(forCreation.safeParse(crisisAction(props)).success).toBe(false)
  })

  it('rejects unknown top-level keys', () => {
    const props = validProps()
    props.unexpected = 'nope'
    expect(forCreation.safeParse(crisisAction(props)).success).toBe(false)
  })

  it('rejects unknown keys inside data', () => {
    const props = validProps()
    props.data.unexpected = 'nope'
    expect(forCreation.safeParse(crisisAction(props)).success).toBe(false)
  })

  it('allows optional name and description inside data', () => {
    const props = validProps()
    props.data.name = 'a name'
    props.data.description = 'a description'
    expect(forCreation.safeParse(crisisAction(props)).success).toBe(true)
  })
})

describe('forCreation - custom-request additionalProperties', () => {
  const customAction = (additionalProperties) => {
    const data = cronMonitor()
    data.monitor.action = {
      type: 'custom-request',
      url: 'https://example.com/hook',
      additionalProperties
    }
    return data
  }

  it('requires a method', () => {
    expect(forCreation.safeParse(customAction({})).success).toBe(false)
  })

  it('rejects an unsupported method', () => {
    expect(forCreation.safeParse(customAction({ method: 'patch' })).success).toBe(false)
  })

  it('accepts get, post, put and delete', () => {
    for (const method of ['get', 'post', 'put', 'delete']) {
      expect(forCreation.safeParse(customAction({ method })).success).toBe(true)
    }
  })

  it('defaults headers and body to empty objects', () => {
    const result = forCreation.safeParse(customAction({ method: 'post' }))
    expect(result.success).toBe(true)
    expect(result.data.monitor.action.additionalProperties.headers).toEqual({})
    expect(result.data.monitor.action.additionalProperties.body).toEqual({})
  })

  it('rejects unknown keys', () => {
    expect(forCreation.safeParse(customAction({ method: 'post', nope: 1 })).success).toBe(false)
  })
})

describe('forUpdate', () => {
  it('accepts a valid cron monitor', () => {
    const data = cronMonitor()
    data.monitor.enabled = true
    expect(forUpdate.safeParse(data).success).toBe(true)
  })

  it('rejects dryRun (not allowed on update)', () => {
    const data = cronMonitor()
    data.monitor.type = 'dryRun'
    data.monitor.enabled = true
    expect(forUpdate.safeParse(data).success).toBe(false)
  })

  it('requires enabled to be provided explicitly', () => {
    const data = cronMonitor()
    expect(forUpdate.safeParse(data).success).toBe(false)
  })

  it('requires a name', () => {
    const data = cronMonitor()
    data.monitor.enabled = true
    delete data.monitor.name
    expect(forUpdate.safeParse(data).success).toBe(false)
  })
})

describe('validatePatchSchema', () => {
  const current = () => ({
    _id: 'abc',
    target: { name: 'targetLayer' },
    zone: { name: 'zoneLayer' },
    monitor: {
      name: 'existing-monitor',
      description: 'existing description',
      type: 'cron',
      trigger: '*/5 * * * *',
      enabled: true,
      evaluation: { alertOn: 'data', type: 'intersects' },
      action: { type: 'no-webhook', cooldown: 60 }
    }
  })

  it('fills unspecified fields from the current monitor', () => {
    const result = validatePatchSchema(current(), { monitor: { description: 'updated' } })
    expect(result.success).toBe(true)
    expect(result.data.monitor.description).toBe('updated')
    expect(result.data.monitor.name).toBe('existing-monitor')
    expect(result.data.target.name).toBe('targetLayer')
  })

  it('keeps the current type and trigger when neither is supplied', () => {
    const result = validatePatchSchema(current(), {})
    expect(result.success).toBe(true)
    expect(result.data.monitor.type).toBe('cron')
    expect(result.data.monitor.trigger).toBe('*/5 * * * *')
  })

  it('rejects a new trigger that is invalid for the current type', () => {
    const result = validatePatchSchema(current(), { monitor: { trigger: 'nonsense' } })
    expect(result.success).toBe(false)
  })

  it('validates a type change against the newly supplied trigger', () => {
    const result = validatePatchSchema(current(), {
      monitor: { type: 'event', trigger: ['created'] }
    })
    expect(result.success).toBe(true)
    expect(result.data.monitor.type).toBe('event')
  })

  it('rejects a type change whose trigger is incompatible', () => {
    const result = validatePatchSchema(current(), { monitor: { type: 'event' } })
    expect(result.success).toBe(false)
  })
})
