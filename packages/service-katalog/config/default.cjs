const fs = require('node:fs')
const path = require('node:path')
const winston = require('winston')
const express = require('@feathersjs/express')

const host = process.env.HOSTNAME || 'localhost'
const port = process.env.PORT || 8187
const apiPath = process.env.API_PREFIX || '/api'
/* please refer to https://web.dev/articles/how-to-use-local-https for setup */
const https = null
const baseUrl = process.env.BASE_URL || (https ? `https://${host}:${port}${apiPath}` : `http://${host}:${port}${apiPath}`)
const logsDir = path.join(__dirname, '..', 'logs')

fs.mkdirSync(logsDir, { recursive: true })

module.exports = {
  host,
  port,
  https,
  baseUrl,
  apiPath,
  logs: {
    Console: {
      format: winston.format.combine(winston.format.colorize(), winston.format.simple()),
      level: (process.env.NODE_ENV === 'development' ? 'verbose' : 'info')
    },
    DailyRotateFile: {
      format: winston.format.json(),
      dirname: logsDir,
      filename: 'katalog-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: '30d'
    }
  },
  public: './public/',
  origins: [
    'http://localhost:3030'
  ],
  paginate: {
    default: 10,
    max: 50
  },
  db: {
    adapter: 'mongodb',
    url: 'mongodb://127.0.0.1:27017/katalog'
  },
  distribution: {
    key: 'katalog',
    authentication: false,
    publicationDelay: 5000,
    heartbeatInterval: 10000,
    timeout: 30000,
    services: (service) => true,
    remoteServices: (service) => false,
    distributedMethods: ['find', 'get', 'create', 'update', 'patch', 'remove'],
    distributedEvents: ['created', 'updated', 'patched', 'removed'],
    middlewares: { after: express.errorHandler() }
  }
}
