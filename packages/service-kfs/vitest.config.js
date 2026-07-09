import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { defineConfig, mergeConfig } from 'vitest/config'
import { baseConfig } from '../../vitest.base-config'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default mergeConfig(baseConfig, defineConfig({
  root: __dirname,
  test: {
    name: 'service-kfs',
    // Only this package's own tests — the nested mcp/ package has its own config.
    include: ['test/**/*.test.js'],
    env: {
      // Vite injects BASE_URL='/' into the test env, which would hijack the app
      // config (config/default.cjs uses `process.env.BASE_URL || ...`) and make
      // baseUrl '/'. Clear it so baseUrl is computed from host/port/apiPath.
      BASE_URL: ''
    }
  }
}))
