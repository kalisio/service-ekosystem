import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { defineConfig, mergeConfig } from 'vitest/config'
import { baseConfig } from '../../../vitest.base-config'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Both suites share this config:
//   - test/server.test.js       fast unit tests (mocked KFS, no MongoDB)
//   - test/integration.test.js  end-to-end against a real KFS + MongoDB
// The scripts pick which to run: `test` targets the unit file, while
// `test:integration` targets the integration file (with NODE_CONFIG_DIR set).
// Timeouts are sized for the integration setup; unit tests finish well under them.
export default mergeConfig(baseConfig, defineConfig({
  root: __dirname,
  test: {
    name: 'kfs-mcp',
    include: ['test/**/*.test.js'],
    testTimeout: 60000,
    hookTimeout: 60000,
    coverage: {
      include: ['server.js']
    }
  }
}))
