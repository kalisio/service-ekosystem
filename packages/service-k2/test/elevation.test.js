import path from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { elevation } from '../src/elevation.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// GMTED2010 mx30 subset over the Pyrenees.
const demFile = path.join(__dirname, 'data/GMTED2010/mx30-pyrenees.tif')
const demOverride = path.relative('/mbtiles', demFile)

// elevation() shells out to gdalwarp, skip the suite if GDAL is not installed.
let hasGdal = true
try {
  execSync('gdalwarp --version', { stdio: 'ignore' })
} catch {
  hasGdal = false
}

function lineString (coordinates) {
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates }
  }
}

describe.skipIf(!hasGdal)('k2:elevation', () => {
  it('computes an elevation profile across the Pyrenees from the mx30 DEM', async () => {
    const profile = lineString([[0.65, 43.1], [0.65, 42.2]])
    const result = await elevation(profile, { demOverride, resolution: 1000 })

    expect(result.type).toBe('FeatureCollection')
    expect(result.features.length).toBeGreaterThan(50)

    const zValues = []
    let previousT = -Infinity
    for (const feature of result.features) {
      expect(feature.geometry.type).toBe('Point')
      expect(feature.geometry.coordinates).toHaveLength(2)
      const { z, t } = feature.properties
      expect(typeof z).toBe('number')
      expect(typeof t).toBe('number')
      // distance must grow monotonically along the profile
      expect(t).toBeGreaterThanOrEqual(previousT)
      previousT = t
      // every sample stays within the DEM's plausible elevation range
      expect(z).toBeGreaterThan(-100)
      expect(z).toBeLessThan(3300)
      zValues.push(z)
    }

    // crossing the main crest must reach high elevations
    expect(Math.max(...zValues)).toBeGreaterThan(1500)
  }, 60000)

  it('honors elevationOffset by shifting every sample', async () => {
    const profile = lineString([[0.65, 43.1], [0.65, 42.2]])
    const offset = 100

    const base = await elevation(profile, { demOverride, resolution: 1000 })
    const shifted = await elevation(profile, { demOverride, resolution: 1000, elevationOffset: offset })

    expect(shifted.features.length).toBe(base.features.length)
    shifted.features.forEach((feature, i) => {
      expect(feature.properties.z).toBe(base.features[i].properties.z + offset)
    })
  }, 60000)

  it('snaps the last sample to the profile end point', async () => {
    const end = [0.65, 42.2]
    const profile = lineString([[0.65, 43.1], end])
    const result = await elevation(profile, { demOverride, resolution: 1000 })

    const lastPoint = result.features[result.features.length - 1]
    expect(lastPoint.geometry.coordinates[0]).toBeCloseTo(end[0], 6)
    expect(lastPoint.geometry.coordinates[1]).toBeCloseTo(end[1], 6)
  }, 60000)

  it('returns an empty collection for a degenerate (zero-length) line', async () => {
    const profile = lineString([[0.65, 43.0], [0.65, 43.0]])
    const result = await elevation(profile, { demOverride, resolution: 1000 })
    expect(result.type).toBe('FeatureCollection')
    expect(result.features).toHaveLength(0)
  }, 60000)
})
