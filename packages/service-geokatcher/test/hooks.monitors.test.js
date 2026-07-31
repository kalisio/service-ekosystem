import { describe, it, expect } from 'vitest'
import { escapeToBSON, unescapeFromBSON } from '../src/hooks/hooks.monitors.js'

describe('escapeToBSON', () => {
  it('escapes the keys of the data that will be saved', () => {
    const hook = { data: { target: { filter: { 'properties.deviceId': { $gt: 10 } } } } }
    escapeToBSON(hook)
    expect(hook.data.target.filter).toEqual({ 'properties．deviceId': { '＄gt': 10 } })
  })

  it('assigns the escaped data to hook.data, not to some other key', () => {
    // guards against `_.set(hook, data, ...)`, which used the data object as a path
    // and left hook.data untouched
    const hook = { data: { 'a.b': 1 } }
    escapeToBSON(hook)
    expect(Object.keys(hook)).toEqual(['data'])
    expect(hook.data).toEqual({ 'a．b': 1 })
  })

  it('leaves the values alone', () => {
    const hook = { data: { monitor: { action: { url: 'https://hooks.slack.com/services/x.y' } } } }
    escapeToBSON(hook)
    expect(hook.data.monitor.action.url).toBe('https://hooks.slack.com/services/x.y')
  })

  it('copes with a hook that carries no data', () => {
    const hook = {}
    escapeToBSON(hook)
    expect(hook.data).toEqual({})
  })
})

describe('unescapeFromBSON', () => {
  it('restores the keys of a single result', () => {
    const hook = { result: { target: { filter: { 'properties．deviceId': { '＄gt': 10 } } } } }
    unescapeFromBSON(hook)
    expect(hook.result.target.filter).toEqual({ 'properties.deviceId': { $gt: 10 } })
  })

  it('restores the keys of a paginated result', () => {
    const hook = { result: { data: [{ 'a．b': 1 }, { '＄or': 2 }] } }
    unescapeFromBSON(hook)
    expect(hook.result.data).toEqual([{ 'a.b': 1 }, { $or: 2 }])
  })

  it('leaves a result that was never escaped unchanged', () => {
    // documents written before the escaping was applied must still read correctly
    const hook = { result: { 'properties.deviceId': 10, url: 'https://example.com/x.y' } }
    unescapeFromBSON(hook)
    expect(hook.result).toEqual({ 'properties.deviceId': 10, url: 'https://example.com/x.y' })
  })
})

describe('escape then unescape', () => {
  it('gives back the original monitor', () => {
    const monitor = {
      target: { name: 'layer', filter: { 'properties.id': { $in: [1, 2] } } },
      zone: { name: 'zone', filter: {} },
      monitor: {
        name: 'my-monitor',
        type: 'cron',
        trigger: '*/5 * * * *',
        action: { type: 'slack-webhook', url: 'https://hooks.slack.com/services/x.y' }
      }
    }
    const hook = { data: structuredClone(monitor) }
    escapeToBSON(hook)
    const read = { result: hook.data }
    unescapeFromBSON(read)
    expect(read.result).toEqual(monitor)
  })
})
