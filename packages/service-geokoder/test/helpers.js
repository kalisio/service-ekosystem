import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { vi } from 'vitest'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Responses captured from the real geocoding services
export function fixture (name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'data/geocoders', `${name}.json`), 'utf8'))
}

// A fetch mock always answering with the given body and status
export function mockFetch (body, status = 200) {
  return vi.fn(async () => ({ ok: status < 400, status, json: async () => body }))
}

export function requestedUrl (fetch, call = 0) {
  return new URL(fetch.mock.calls[call][0])
}

// A minimal application exposing the given providers configuration
export function createApp (providers) {
  return { get: (key) => ({ providers })[key], logger: { warn: vi.fn() } }
}

export const viewbox = { minLon: 1.891365, minLat: 43.283502, maxLon: 2.010069, maxLat: 43.340896 }
