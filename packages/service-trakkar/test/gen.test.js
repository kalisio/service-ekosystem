import { describe, it, expect } from 'vitest'
import { interpolatePoints, calculateCourse, randomInt } from './gen.js'

describe('gen interpolatePoints (closed loop)', () => {
  it('walks out and back around a closed loop of waypoints', () => {
    const waypoints = [[0, 0], [0, 0.5]]
    const points = interpolatePoints(waypoints, 0.09)
    expect(points.length).toBeGreaterThan(2)
    expect(points[0]).toEqual([0, 0])
    const returnsToStart = points.slice(Math.floor(points.length / 2)).some(([lat, lon]) => lon < 0.5)
    expect(returnsToStart).toBe(true)
  })
})

describe('gen calculateCourse', () => {
  it('returns a bearing within 0-360 degrees', () => {
    const course = calculateCourse(0, 0, 1, 1)
    expect(course).toBeGreaterThanOrEqual(0)
    expect(course).toBeLessThan(360)
  })

  it('heading due east is close to 90 degrees', () => {
    const course = calculateCourse(0, 0, 0, 1)
    expect(course).toBeCloseTo(90, 5)
  })
})

describe('gen randomInt', () => {
  it('stays within the inclusive range and returns an integer', () => {
    for (let i = 0; i < 100; i++) {
      const n = randomInt(0, 100)
      expect(Number.isInteger(n)).toBe(true)
      expect(n).toBeGreaterThanOrEqual(0)
      expect(n).toBeLessThanOrEqual(100)
    }
  })
})
