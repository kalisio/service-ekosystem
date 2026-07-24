import { describe, it, expect } from 'vitest'
import path from 'path'
import { fileURLToPath } from 'url'
import { Device, loadDevicesFromFolder } from './demo.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const trajectoryFolder = path.join(__dirname, 'trajectory')

describe('Device.loadWaypointsFromGeojson', () => {
  it('loads the coordinates from a LineString GeoJSON file', () => {
    const waypoints = Device.loadWaypointsFromGeojson(path.join(trajectoryFolder, 'vehicule1.json'))
    expect(Array.isArray(waypoints)).toBe(true)
    expect(waypoints.length).toBeGreaterThan(0)
    expect(waypoints[0]).toHaveLength(2)
  })

  it('throws when the file does not exist', () => {
    expect(() => Device.loadWaypointsFromGeojson('does-not-exist.json')).toThrow(/not found/)
  })
})

describe('Device.interpolatePoints', () => {
  it('inserts intermediate points between two waypoints', () => {
    const waypoints = [[0, 0], [0.01, 0]]
    const points = Device.interpolatePoints(waypoints, 0.0009)
    expect(points.length).toBeGreaterThan(2)
    expect(points[0]).toEqual([0, 0])
    expect(points[points.length - 1]).toEqual([0, 0.01])
  })
})

describe('Device.calculateCourse', () => {
  it('returns a bearing within 0-360 degrees', () => {
    const course = Device.calculateCourse(0, 0, 1, 1)
    expect(course).toBeGreaterThanOrEqual(0)
    expect(course).toBeLessThan(360)
  })

  it('heading due north is close to 0 degrees', () => {
    const course = Device.calculateCourse(0, 0, 1, 0)
    expect(course).toBeCloseTo(0, 5)
  })

  it('heading due east is close to 90 degrees', () => {
    const course = Device.calculateCourse(0, 0, 0, 1)
    expect(course).toBeCloseTo(90, 5)
  })
})

describe('Device.calculateBatteryLevel', () => {
  it('reports full battery at the start and empty at the end', () => {
    const device = new Device('vehicule1', path.join(trajectoryFolder, 'vehicule1.json'), 40)
    device.index = 0
    expect(device.calculateBatteryLevel()).toBe(100)
    device.index = device.totalPoints - 1
    expect(device.calculateBatteryLevel()).toBe(0)
  })
})

describe('loadDevicesFromFolder', () => {
  it('builds one Device per trajectory file', () => {
    const devices = loadDevicesFromFolder(trajectoryFolder, 40)
    expect(devices.length).toBeGreaterThan(0)
    for (const device of devices) {
      expect(device).toBeInstanceOf(Device)
      expect(device.points.length).toBeGreaterThan(0)
    }
  })

  it('throws when the folder does not exist', () => {
    expect(() => loadDevicesFromFolder('no-such-folder', 40)).toThrow(/not found/)
  })
})
