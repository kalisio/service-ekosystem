import { describe, afterAll } from 'vitest'

import initTest from './init.test.js'
import kanoTest from './kano.test.js'
import geoKatcherSchemaTest from './geokatchertest-suites/geokatcher-creation.test.js'
import geoKatcherPatchTest from './geokatchertest-suites/geokatcher-patch.test.js'
import geoKatcherMonitorTest from './geokatchertest-suites/geokatcher-monitor.test.js'

// Shared between the suites below: each one fills in what it creates, so the next
// can use it. `this` inside a suite is this object, hence the bind() calls.
const globals = {
  server: undefined,
  app: undefined,
  kapp: undefined,
  catalogService: undefined,
  defaultLayers: undefined,
  featuresService: undefined,
  hubeauHydroStationsService: undefined
}

describe('geokatcher:init', initTest.bind(globals))

describe('geokatcher:kano', kanoTest.bind(globals))

describe('geokatcher:geokatcher-creation', geoKatcherSchemaTest.bind(globals))
describe('geokatcher:geokatcher-patch', geoKatcherPatchTest.bind(globals))
describe('geokatcher:geokatcher-monitor', geoKatcherMonitorTest.bind(globals))

afterAll(async () => {
  // Empty every collection the suites filled, then shut both apps down
  await globals.catalogService?._remove(null, { query: {} })
  await globals.featuresService?._remove(null, { query: {} })
  await globals.hubeauHydroStationsService?._remove(null, { query: {} })
  await globals.app?.service('monitor')._remove(null, { query: {} })
  if (globals.server) await globals.server.close()
  await globals.kapp?.teardown()
})
