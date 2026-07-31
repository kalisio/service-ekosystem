import { describe, it, expect } from 'vitest'
import { ObjectId } from 'mongodb'
import { escape, unescape } from '../src/common/mongo-escape.js'

describe('escape', () => {
  it('replaces $ and . in the keys', () => {
    expect(escape({ $gt: 1 })).toEqual({ '＄gt': 1 })
    expect(escape({ 'properties.deviceId': 5 })).toEqual({ 'properties．deviceId': 5 })
  })

  it('walks nested objects and arrays', () => {
    const filter = { $and: [{ 'a.b': { $in: [1, 2] } }, { $or: [{ 'c.d': 3 }] }] }
    expect(escape(filter)).toEqual({
      '＄and': [{ 'a．b': { '＄in': [1, 2] } }, { '＄or': [{ 'c．d': 3 }] }]
    })
  })

  it('leaves the values untouched', () => {
    // a url or a description is perfectly legal in MongoDB, rewriting it would corrupt it
    const data = { url: 'https://example.com/hook', description: 'coûte 5$ par mois' }
    expect(escape(data)).toEqual(data)
  })

  it('leaves keys without $ or . untouched', () => {
    expect(escape({ name: 'monitor', enabled: true })).toEqual({ name: 'monitor', enabled: true })
  })

  it('preserves the types MongoDB handles natively', () => {
    const id = new ObjectId()
    const date = new Date('2024-01-01T00:00:00Z')
    const result = escape({ _id: id, 'a.b': date })
    expect(result._id).toBe(id)
    expect(result['a．b']).toBe(date)
    expect(result['a．b'] instanceof Date).toBe(true)
  })

  it('passes primitives through', () => {
    expect(escape(42)).toBe(42)
    expect(escape(null)).toBe(null)
    expect(escape(undefined)).toBe(undefined)
    expect(escape('a.b')).toBe('a.b') // a bare string is a value, not a key
  })

  it('rejects what cannot be stored', () => {
    expect(() => escape({ fn: () => {} })).toThrow(/function or a symbol/)
    expect(() => escape({ sym: Symbol('x') })).toThrow(/function or a symbol/)
  })

  it('does not modify its input', () => {
    const original = { $gt: 1, nested: { 'a.b': 2 } }
    const copy = JSON.parse(JSON.stringify(original))
    escape(original)
    expect(original).toEqual(copy)
  })
})

describe('unescape', () => {
  it('restores $ and . in the keys', () => {
    expect(unescape({ '＄gt': 1 })).toEqual({ $gt: 1 })
    expect(unescape({ 'properties．deviceId': 5 })).toEqual({ 'properties.deviceId': 5 })
  })

  it('walks nested objects and arrays', () => {
    const stored = { '＄and': [{ 'a．b': { '＄in': [1, 2] } }] }
    expect(unescape(stored)).toEqual({ $and: [{ 'a.b': { $in: [1, 2] } }] })
  })
})

describe('escape/unescape round trip', () => {
  it('returns the original filter', () => {
    const filters = [
      {},
      { $and: [{ 'properties.deviceId': { $gt: 10 } }, { 'b.c': { $ne: null } }] },
      { 'a.b.c.d': 1 },
      { $or: [{ x: 'https://example.com' }, { y: 'text with $ and . inside' }] }
    ]
    for (const filter of filters) {
      expect(unescape(escape(filter))).toEqual(filter)
    }
  })

  it('survives a full monitor object', () => {
    const monitor = {
      target: { name: 'layer', filter: { 'properties.id': { $in: [1, 2] } } },
      zone: { name: 'zone', filter: {} },
      monitor: {
        name: 'my-monitor',
        type: 'cron',
        trigger: '*/5 * * * *',
        enabled: true,
        evaluation: { alertOn: 'data', type: 'intersects' },
        action: { type: 'slack-webhook', url: 'https://hooks.slack.com/services/x.y', cooldown: 60 }
      }
    }
    expect(unescape(escape(monitor))).toEqual(monitor)
    // the webhook url must come back exactly as it went in
    expect(unescape(escape(monitor)).monitor.action.url).toBe('https://hooks.slack.com/services/x.y')
  })
})
