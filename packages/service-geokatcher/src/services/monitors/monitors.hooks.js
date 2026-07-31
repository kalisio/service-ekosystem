// Application hooks that run for the monitor service
import { parseQuery, escapeToBSON, unescapeFromBSON, stopMonitor, startMonitor, runEvaluation, validateMonitorStructure, resetMonitor, checkIfNameAlreadyExists, checkIfMonitorExists, setTimestamps } from '../../hooks/hooks.monitors.js'

export default {
  before: {
    all: [],
    find: [parseQuery],
    get: [parseQuery],
    create: [validateMonitorStructure, setTimestamps, runEvaluation, checkIfNameAlreadyExists, startMonitor],
    update: [checkIfMonitorExists, validateMonitorStructure, setTimestamps, checkIfNameAlreadyExists, runEvaluation, escapeToBSON, resetMonitor],
    patch: [checkIfMonitorExists, validateMonitorStructure, setTimestamps, checkIfNameAlreadyExists, runEvaluation, escapeToBSON, resetMonitor],
    remove: []
  },

  after: {
    all: [unescapeFromBSON],
    find: [],
    get: [],
    create: [],
    update: [],
    patch: [],
    remove: [stopMonitor]
  },

  error: {
    all: [],
    find: [],
    get: [],
    create: [],
    update: [],
    patch: [],
    remove: []
  }
}
