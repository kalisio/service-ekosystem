import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { setTimeout as sleep } from 'timers/promises'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const SERVER = 'http://localhost:5055'
const PERIOD = 100
const STEP = 0.0009
const TRAJECTORY_FOLDER = 'trajectory'

export class Device {
  constructor (deviceId, geojsonPath, speed) {
    this.deviceId = deviceId
    this.speed = speed
    this.waypoints = Device.loadWaypointsFromGeojson(geojsonPath)
    this.points = Device.interpolatePoints(this.waypoints, STEP)
    this.index = 0
    this.totalPoints = this.points.length
  }

  static loadWaypointsFromGeojson (filepath) {
    if (!fs.existsSync(filepath)) {
      throw new Error(`File ${filepath} not found.`)
    }
    const data = JSON.parse(fs.readFileSync(filepath, 'utf8'))
    if (!data.geometry || data.geometry.type !== 'LineString') {
      throw new Error(`File ${filepath} must have LineString geometry.`)
    }
    return data.geometry.coordinates ?? []
  }

  static interpolatePoints (waypoints, step) {
    const points = []
    for (let i = 0; i < waypoints.length - 1; i++) {
      const [lon1, lat1] = waypoints[i]
      const [lon2, lat2] = waypoints[i + 1]
      const length = Math.sqrt((lat2 - lat1) ** 2 + (lon2 - lon1) ** 2)
      const count = Math.ceil(length / step)
      for (let j = 0; j < count; j++) {
        const lat = lat1 + (lat2 - lat1) * j / count
        const lon = lon1 + (lon2 - lon1) * j / count
        points.push([lat, lon])
      }
    }
    points.push([waypoints[waypoints.length - 1][1], waypoints[waypoints.length - 1][0]])
    return points
  }

  static calculateCourse (lat1, lon1, lat2, lon2) {
    lat1 = lat1 * Math.PI / 180
    lon1 = lon1 * Math.PI / 180
    lat2 = lat2 * Math.PI / 180
    lon2 = lon2 * Math.PI / 180
    const y = Math.sin(lon2 - lon1) * Math.cos(lat2)
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1)
    return (((Math.atan2(y, x) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) * 180 / Math.PI
  }

  // Computes the remaining battery based on the progression
  calculateBatteryLevel () {
    return Math.max(0, 100 - (this.index / (this.totalPoints - 1)) * 100)
  }

  async sendData (lat, lon, course, speed, battery) {
    const params = new URLSearchParams({
      id: this.deviceId,
      timestamp: Math.floor(Date.now() / 1000),
      lat,
      lon,
      bearing: course,
      speed,
      batt: battery.toFixed(2) // Battery rounded to two decimals
    })
    const response = await fetch(`${SERVER}/?${params.toString()}`)
    await response.text()
  }

  async simulate () {
    while (this.index < this.totalPoints) {
      const [lat1, lon1] = this.points[this.index % this.points.length]
      const [lat2, lon2] = this.index + 1 < this.totalPoints
        ? this.points[(this.index + 1) % this.points.length]
        : [lat1, lon1]
      const course = this.index + 1 < this.totalPoints ? Device.calculateCourse(lat1, lon1, lat2, lon2) : 0
      const speed = this.index + 1 < this.totalPoints ? this.speed : 0
      const battery = this.calculateBatteryLevel()
      await this.sendData(lat1, lon1, course, speed, battery)
      await sleep(PERIOD)
      this.index += 1
    }
  }
}

// Loads the devices from the trajectory folder
export function loadDevicesFromFolder (folder, speed) {
  const devices = []
  if (!fs.existsSync(folder)) {
    throw new Error(`The folder ${folder} was not found.`)
  }

  for (const filename of fs.readdirSync(folder)) {
    if (filename.endsWith('.json')) {
      const deviceId = path.parse(filename).name // File name without the extension
      const geojsonPath = path.join(folder, filename)
      devices.push(new Device(deviceId, geojsonPath, speed))
    }
  }
  return devices
}

async function main () {
  console.log('Loading devices...')
  const devices = loadDevicesFromFolder(path.join(__dirname, TRAJECTORY_FOLDER), 40)

  if (devices.length === 0) {
    console.log('No device found in the folder.')
    process.exit()
  }

  // Run every device in parallel
  await Promise.all(devices.map(device => device.simulate()))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main()
}
