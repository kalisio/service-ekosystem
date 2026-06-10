const express = require('@feathersjs/express')

module.exports = {
  apiPath: '/api',
  host: process.env.HOSTNAME || 'localhost',
  port: process.env.PORT || 8187,
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
    distributedMethods: ['find', 'get', 'create', 'update', 'patch', 'remove'],
    distributedEvents: ['created', 'updated', 'patched', 'removed'],
    middlewares: { after: express.errorHandler() }
  }
}
