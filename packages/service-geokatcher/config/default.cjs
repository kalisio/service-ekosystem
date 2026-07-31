const path = require('path')
const winston = require('winston')

const host = process.env.HOSTNAME || 'localhost'
const dbUrl = process.env.DB_URL || 'mongodb://localhost:27017/geokatcher'
const port = process.env.PORT || 8080
const apiPath = process.env.API_PREFIX || '/api'
const baseUrl = process.env.BASE_URL || `http://${host}:${port}`

module.exports = {
  host,
  port,
  baseUrl,
  apiPath,
  dbUrl,

  logs: {
    Console: {
      format: winston.format.combine(winston.format.colorize(), winston.format.simple()),
      level: (process.env.NODE_ENV === 'development' ? 'verbose' : 'info')
    },
    DailyRotateFile: {
      format: winston.format.json(),
      dirname: path.join(__dirname, '..', 'logs'),
      filename: 'geokatcher-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: '30d'
    }
  },
  distribution: {
    // for now we don't distribute the monitor service
    services: (service) => false,
    // Use only Kano services
    remoteServices: (service) => (service.key === 'kano'),
    healthcheckPath: apiPath + '/distribution/',
    key: 'services'
  }
}
