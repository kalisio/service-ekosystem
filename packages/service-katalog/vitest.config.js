import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { defineConfig, mergeConfig } from 'vitest/config'
import { baseConfig } from '../../vitest.base-config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default mergeConfig(baseConfig, defineConfig({
  root: __dirname,
  test: {
    name: 'katalog',
    env: {
      NODE_CONFIG_DIR: path.join(__dirname, 'config'),
      NODE_ENV: 'test'
    }
  }
}))
