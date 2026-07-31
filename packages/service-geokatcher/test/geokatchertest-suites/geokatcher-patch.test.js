import { expect, it, beforeAll, afterAll, afterEach } from 'vitest'
import { expectError } from '../tools.js'
import _ from 'lodash'

async function geoKatcherPatchTest () {
  let app, baseMonitorObject, monitorObject
  beforeAll(async () => {
    app = this.app
    baseMonitorObject = {
      target: {
        name: 'target',
        filter: {
          'properties.name': 'randomname'
        }
      },
      zone: {
        name: 'zone'
      },
      monitor: {
        type: 'event',
        enabled: false,
        name: 'monitor',
        trigger: ['patched'],
        evaluation: {
          type: 'geoIntersects'
        }
      }
    }
    // Create the monitor
    monitorObject = await app.service('monitor').create(baseMonitorObject)
  })

  afterEach(async () => {
    // revert the monitor object to its original state
    await app.service('monitor').patch(monitorObject._id, baseMonitorObject)
  })
  it('patch the target name with layer that does not exist should throw a NotFound with message "Layer not found', async () => {
    await expectError(() =>
      app.service('monitor').patch(monitorObject._id, { target: { name: 'xxx' } }),
    'Layer not found')
  }, 1000)

  it('patch only the target should leave the rest of the object unchanged', async () => {
    const patchedMonitor = await app.service('monitor').patch(monitorObject._id, { target: { name: 'zone' } })
    const omit = ['target', 'monitor.lastRun', 'updatedAt']
    expect(_.omit(patchedMonitor, omit)).toEqual(_.omit(monitorObject, omit))
    expect(patchedMonitor.target.name).toBe('zone')
    expect(patchedMonitor.updatedAt).not.toBe(monitorObject.updatedAt)
    expect(patchedMonitor.monitor.lastRun).not.toBe(monitorObject.monitor.lastRun)
  }, 1000)

  it('patch the target name with layer that does exist should return the patched object', async () => {
    const patchedMonitor = await app.service('monitor').patch(monitorObject._id, { target: { name: 'zone' } })
    expect(patchedMonitor.target.name).toBe('zone')
  }, 1000)

  it('patch the target name should reset the filters', async () => {
    const patchedMonitor = await app.service('monitor').patch(monitorObject._id, { target: { name: 'zone' } })
    expect(patchedMonitor.target.filter).toBe(undefined)
  }, 1000)

  it('patch the target filter should return the patched object with new filter', async () => {
    const patchedMonitor = await app.service('monitor').patch(monitorObject._id, { target: { filter: { 'properties.name': 'newName' } } })
    expect(patchedMonitor.target.filter).toEqual({ 'properties.name': 'newName' })
  }, 1000)

  it('patch the monitor trigger (event) with an invalid (event) trigger should throw a BadRequest ', async () => {
    // not an array
    await expectError(() =>
      app.service('monitor').patch(monitorObject._id, { monitor: { trigger: 'notanarray' } }),
    'if "monitor.type" is "event","monitor.trigger" must be an array')

    // not an array of strings
    await expectError(() =>
      app.service('monitor').patch(monitorObject._id, { monitor: { trigger: [1, 2, 3] } }),
    'if "monitor.type" is "event",all elements of "monitor.trigger" must be strings')
  }, 1000)

  it('patch the monitor trigger (event) with a valid (event) trigger should return the patched object', async () => {
    const patchedMonitor = await app.service('monitor').patch(monitorObject._id, { monitor: { trigger: ['created', 'patched', 'removed'] } })
    expect(patchedMonitor.monitor.trigger).toEqual(['created', 'patched', 'removed'])
  }, 1000)

  it('patch the monitor type from event to cron without changing the trigger should throw a BadRequest', async () => {
    await expectError(() =>
      app.service('monitor').patch(monitorObject._id, { monitor: { type: 'cron' } }),
    'if "monitor.type" is "cron","monitor.trigger" must be a string')
  }, 1000)

  it('patch the monitor type from event to cron with a valid trigger should return the patched object', async () => {
    const patchedMonitor = await app.service('monitor').patch(monitorObject._id, { monitor: { type: 'cron', trigger: '*/5 * * * *' } })
    expect(patchedMonitor.monitor.type).toBe('cron')
    expect(patchedMonitor.monitor.trigger).toBe('*/5 * * * *')
    const omit = ['monitor.lastRun', 'monitor.trigger', 'monitor.type', 'updatedAt']
    expect(_.omit(patchedMonitor, omit)).toEqual(_.omit(monitorObject, omit))
  }, 1000)

  it('patch the monitor type to dryRun should return a BadRequest', async () => {
    await expectError(() =>
      app.service('monitor').patch(monitorObject._id, { monitor: { type: 'dryRun' } }),
    '"monitor.type" must be one of [cron, event]')
  }, 1000)

  it('patch the action to an invalid action should throw a BadRequest', async () => {
    await expectError(() =>
      app.service('monitor').patch(monitorObject._id, { monitor: { action: 'invalidAction' } }),
    '"monitor.action" must be of type object')
  }, 1000)

  it('patch the action to anything other than "no-webhook" with no url should throw a BadRequest', async () => {
    await expectError(() =>
      app.service('monitor').patch(monitorObject._id, { monitor: { action: { type: 'slack-webhook' } } }),
    '"monitor.action.url" is required')
  }, 1000)

  it('patch the action to no-webhook should return the patched object', async () => {
    const patchedMonitor = await app.service('monitor').patch(monitorObject._id, { monitor: { action: { type: 'no-webhook' } } })
    expect(patchedMonitor.monitor.action.type).toBe('no-webhook')
    const omit = ['monitor.lastRun', 'updatedAt']
    expect(_.omit(patchedMonitor, omit)).toEqual(_.omit(monitorObject, omit))
  }, 1000)

  it('patch the action to slack-webhook with a valid url should return the patched object', async () => {
    const patchedMonitor = await app.service('monitor').patch(monitorObject._id, { monitor: { action: { type: 'slack-webhook', url: 'https://slack.com' } } })
    expect(patchedMonitor.monitor.action.type).toBe('slack-webhook')
    expect(patchedMonitor.monitor.action.url).toBe('https://slack.com')
    const omit = ['monitor.lastRun', 'monitor.action', 'updatedAt']
    expect(_.omit(patchedMonitor, omit)).toEqual(_.omit(monitorObject, omit))
  }, 1000)

  it('patch the action to slack-webhook with an invalid url should throw a BadRequest', async () => {
    await expectError(() =>
      app.service('monitor').patch(monitorObject._id, { monitor: { action: { type: 'slack-webhook', url: 'xxxx' } } }),
    '"monitor.action.url" must be a valid uri')
  }, 1000)

  it('patch an action from slack-webhook to no-webhook should remove the url', async () => {
    // patch to slack-webhook
    let patchedMonitor = await app.service('monitor').patch(monitorObject._id, { monitor: { action: { type: 'slack-webhook', url: 'https://slack.com' } } })
    expect(patchedMonitor.monitor.action.type).toBe('slack-webhook')
    expect(patchedMonitor.monitor.action.url).toBe('https://slack.com')

    // patch to no-webhook
    patchedMonitor = await app.service('monitor').patch(monitorObject._id, { monitor: { action: { type: 'no-webhook' } } })
    expect(patchedMonitor.monitor.action.type).toBe('no-webhook')
    expect(patchedMonitor.monitor.action.url).toBe(undefined)
    const omit = ['monitor.lastRun', 'updatedAt']
    expect(_.omit(patchedMonitor, omit)).toEqual(_.omit(monitorObject, omit))
  }, 1000)

  it('patch an action from "crisis-webhook" to "no-webhook" should remove the url and additionalProperties', async () => {
    // patch to crisis-webhook
    let patchedMonitor = await app.service('monitor').patch(monitorObject._id, {
      monitor: {
        action: {
          type: 'crisis-webhook',
          url: 'https://crisis.com',
          additionalProperties: {
            organisation: 'Crisis',
            token: '1234',
            data: {
              template: 'template'
            }
          }
        }
      }
    })
    expect(patchedMonitor.monitor.action.type).toBe('crisis-webhook')
    expect(patchedMonitor.monitor.action.url).toBe('https://crisis.com')

    // patch to no-webhook
    patchedMonitor = await app.service('monitor').patch(monitorObject._id, { monitor: { action: { type: 'no-webhook' } } })
    expect(patchedMonitor.monitor.action.type).toBe('no-webhook')
    expect(patchedMonitor.monitor.action.url).toBe(undefined)
    expect(patchedMonitor.monitor.action.additionalProperties).toBe(undefined)
    const omit = ['monitor.lastRun', 'updatedAt']
    expect(_.omit(patchedMonitor, omit)).toEqual(_.omit(monitorObject, omit))
  }, 1000)

  it('patch an action from "crisis-webhook" to "custom-request" should reset the url and additionalProperties', async () => {
    // patch to crisis-webhook
    let patchedMonitor = await app.service('monitor').patch(monitorObject._id, {
      monitor: {
        action: {
          type: 'crisis-webhook',
          url: 'https://crisis.com',
          additionalProperties: {
            organisation: 'Crisis',
            token: '1234',
            data: {
              template: 'template'
            }
          }
        }
      }
    })
    expect(patchedMonitor.monitor.action.type).toBe('crisis-webhook')
    expect(patchedMonitor.monitor.action.url).toBe('https://crisis.com')

    // patch to custom-request
    patchedMonitor = await app.service('monitor').patch(monitorObject._id, { monitor: { action: { type: 'custom-request', url: 'https://custom.com', additionalProperties: { method: 'get', body: { key: 'template' } } } } })
    expect(patchedMonitor.monitor.action.type).toBe('custom-request')
    expect(patchedMonitor.monitor.action.url).toBe('https://custom.com')
    expect(patchedMonitor.monitor.action.additionalProperties).toEqual({ method: 'get', body: { key: 'template' }, headers: {} })
    const omit = ['monitor.lastRun', 'updatedAt', 'monitor.action']
    expect(_.omit(patchedMonitor, omit)).toEqual(_.omit(monitorObject, omit))
  }, 1000)

  afterAll(async () => {
    await app.service('monitor').remove(monitorObject._id)
  })
}

export default geoKatcherPatchTest
