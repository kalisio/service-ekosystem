import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { globSync } from 'glob'
import { config } from '@kalisio/kdk-map-api'
const __dirname = path.dirname(fileURLToPath(import.meta.url))

const kargoDomain = (process.env.SUBDOMAIN ? process.env.SUBDOMAIN : 'test.kalisio.xyz')
const wmtsUrl = (process.env.API_GATEWAY_URL ? process.env.API_GATEWAY_URL + '/wmts/1.0.0' : 'https://mapcache.' + kargoDomain + '/mapcache/wmts/1.0.0')
const tmsUrl = (process.env.API_GATEWAY_URL ? process.env.API_GATEWAY_URL + '/tms/1.0.0' : 'https://mapcache.' + kargoDomain + '/mapcache/tms/1.0.0')
const wmsUrl = (process.env.API_GATEWAY_URL ? process.env.API_GATEWAY_URL + '/wms' : 'https://mapcache.' + kargoDomain + '/mapcache')
const wcsUrl = (process.env.API_GATEWAY_URL ? process.env.API_GATEWAY_URL + '/wcs' : 'https://mapserver.' + kargoDomain + '/cgi-bin/ows')
let k2Url = (process.env.API_GATEWAY_URL ? process.env.API_GATEWAY_URL + '/k2' : 'https://k2.' + kargoDomain)
let s3Url = (process.env.API_GATEWAY_URL ? process.env.API_GATEWAY_URL + '/s3' : 'https://s3.eu-central-1.amazonaws.com')

if (process.env.K2_URL) {
  k2Url = process.env.K2_URL
  console.log(`Using custom K2 URL ${k2Url}`)
}
if (process.env.S3_URL) {
  s3Url = process.env.S3_URL
  console.log(`Using custom S3 URL ${s3Url}`)
}

export async function loadLayers (app) {
  if (!process.env.LAYERS_FILTER) process.env.LAYERS_FILTER = '*'

  const layersDir = path.resolve(__dirname, '../config/layers')

  const layerFiles = globSync(path.join(layersDir, '**/*.cjs').replace(/\\/g, '/'))

  const context = Object.assign({ wmtsUrl, tmsUrl, wmsUrl, wcsUrl, k2Url, s3Url }, app.get('catalog') || {})

  const layers = config.loadLayers(layerFiles, context)

  return layers
}

export async function loadCategories (app) {
  const categoriesDir = path.resolve(__dirname, '../config/categories')
  const categoryFiles = globSync(path.join(categoriesDir, '**/*.cjs').replace(/\\/g, '/'))
  const context = Object.assign({ domain: kargoDomain, wmtsUrl, tmsUrl, wmsUrl, wcsUrl, k2Url, s3Url }, app.get('catalog') || {})
  return config.loadCategories(categoryFiles, context)
}

export async function loadSublegends (app) {
  const sublegendsDir = path.resolve(__dirname, '../config/sublegends')
  const sublegendFiles = globSync(path.join(sublegendsDir, '**/*.cjs').replace(/\\/g, '/'))
  return config.loadSublegends(sublegendFiles)
}
