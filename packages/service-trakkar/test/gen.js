import { setTimeout as sleep } from 'timers/promises'
import { fileURLToPath } from 'url'

const ID = 'nicolas'
const SERVER = 'http://localhost:5055'
const PERIOD = 5000
const STEP = 0.09
const DEVICE_SPEED = 40

// const WAYPOINTS = [
//     (48.853780, 2.344347),
//     (48.855235, 2.345852),
//     (48.857238, 2.347153),
//     (48.858509, 2.342563),
//     (48.856066, 2.340432),
//     (48.854780, 2.342230)
// ]

// const WAYPOINTS = [
//     (43.479516,-1.518921),
//     (43.479755,-1.518038),
//     (43.479927,-1.517028),
//     (43.479794,-1.516492),
//     (43.479498,-1.516545),
//     (43.479218,-1.517211),
//     (43.478712,-1.517114),
//     (43.478455,-1.517512),
//     (43.478689,-1.517995),
//     (43.478782,-1.518682),
//     (43.478564,-1.519637),
//     (43.478658,-1.520346),
//     (43.479171,-1.520421),
//     (43.479421,-1.519282)
// ]

const WAYPOINTS = [
  [43.479874, -1.517287],
  [43.481058, -1.512133],
  [43.481518, -1.513009],
  [43.481805, -1.513379],
  [43.482521, -1.515569],
  [43.483300, -1.516857],
  [43.484234, -1.519777],
  [43.483113, -1.520333],
  [43.480030, -1.52110],
  [43.480123, -1.522696],
  [43.478099, -1.522696]
]

export function interpolatePoints (waypoints, step) {
  const points = []
  for (let i = 0; i < waypoints.length; i++) {
    const [lat1, lon1] = waypoints[i]
    const [lat2, lon2] = waypoints[(i + 1) % waypoints.length]
    const length = Math.sqrt((lat2 - lat1) ** 2 + (lon2 - lon1) ** 2)
    const count = Math.ceil(length / step)
    for (let j = 0; j < count; j++) {
      const lat = lat1 + (lat2 - lat1) * j / count
      const lon = lon1 + (lon2 - lon1) * j / count
      points.push([lat, lon])
    }
  }
  return points
}

export function calculateCourse (lat1, lon1, lat2, lon2) {
  lat1 = lat1 * Math.PI / 180
  lon1 = lon1 * Math.PI / 180
  lat2 = lat2 * Math.PI / 180
  lon2 = lon2 * Math.PI / 180
  const y = Math.sin(lon2 - lon1) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1)
  return (((Math.atan2(y, x) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) * 180 / Math.PI
}

export function randomInt (min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

async function send (lat, lon, altitude, course, speed, battery) {
  const params = new URLSearchParams({
    id: ID,
    timestamp: Math.floor(Date.now() / 1000),
    lat,
    lon,
    altitude,
    bearing: course,
    speed,
    batt: battery
  })
  const response = await fetch(`${SERVER}/?${params.toString()}`)
  await response.text()
}

async function main () {
  const points = interpolatePoints(WAYPOINTS, STEP)
  let index = 0
  while (true) {
    const [lat1, lon1] = points[index % points.length]
    const [lat2, lon2] = points[(index + 1) % points.length]
    const altitude = 50
    const speed = (index % points.length) !== 0 ? DEVICE_SPEED : 0
    const battery = randomInt(0, 100)
    await send(lat1, lon1, altitude, calculateCourse(lat1, lon1, lat2, lon2), speed, battery)
    await sleep(PERIOD)
    index += 1
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main()
}
