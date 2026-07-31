const path = require('path')
const containerized = require('is-docker')()
const dbPORT = 27017

// Use default service config
const config = require(path.join(__dirname, '../../config/default.cjs'))

// Simply changes outputs so we don't pollute logs, etc.
config.logs.DailyRotateFile.dirname = path.join(__dirname, '..', 'logs')

// Use cote defaults to speedup tests
config.distribution.cote = {
  helloInterval: 2000,
  checkInterval: 4000,
  nodeTimeout: 5000,
  masterTimeout: 6000
}
config.distribution.publicationDelay = 3000
config.distribution.remoteServices = (service) => (true)
// This is for KDK test app
config.db = {
  adapter: 'mongodb',
  url: (containerized ? 'mongodb://mongodb:' + dbPORT + '/geokatcher-test' : 'mongodb://127.0.0.1:' + dbPORT + '/geokatcher-test')
}
config.dbUrl = (containerized ? 'mongodb://mongodb:' + dbPORT + '/geokatcher-test' : 'mongodb://127.0.0.1:' + dbPORT + '/geokatcher-test')
module.exports = config
