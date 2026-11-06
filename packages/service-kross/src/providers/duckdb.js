import _ from 'lodash'
import makeDebug from 'debug'
import { DuckDBInstance } from '@duckdb/node-api'
import { filterSources, quoteIdentifier, quoteLiteral } from '../utils.js'

const debug = makeDebug('kross:providers:duckdb')

// Maps our configuration keys to DuckDB S3 secret parameters,
// see https://duckdb.org/docs/stable/core_extensions/httpfs/s3api
const S3_SECRET_KEYS = {
  accessKeyId: 'KEY_ID',
  secretAccessKey: 'SECRET',
  sessionToken: 'SESSION_TOKEN',
  region: 'REGION',
  endpoint: 'ENDPOINT',
  urlStyle: 'URL_STYLE',
  useSsl: 'USE_SSL',
  scope: 'SCOPE'
}

export function createS3SecretStatement (s3) {
  const parameters = ['TYPE s3']
  if (s3.provider) parameters.push(`PROVIDER ${s3.provider}`)
  _.forOwn(S3_SECRET_KEYS, (parameter, key) => {
    const value = s3[key]
    if (_.isNil(value) || value === '') return
    parameters.push(`${parameter} ${_.isBoolean(value) ? value : quoteLiteral(value)}`)
  })
  return `CREATE OR REPLACE SECRET kross_s3 (${parameters.join(', ')})`
}

// Build the SQL FROM expression reading a dataset
export function getDatasetRelation (dataset) {
  if (dataset.relation) return dataset.relation
  const format = dataset.format || (/\.parquet$/i.test(dataset.url) ? 'parquet' : 'gdal')
  switch (format) {
    case 'parquet':
      return `read_parquet(${quoteLiteral(dataset.url)})`
    case 'gdal':
      return `ST_Read(${quoteLiteral(dataset.url)})`
    default:
      throw new Error(`Unsupported dataset format ${format}`)
  }
}

// Build the intersection query of a dataset, parameters are:
// $1: input geometry as GeoJSON, $2: limit
export function getIntersectQuery (dataset, { clip }) {
  const geometry = `d.${quoteIdentifier(dataset.geometry)}`
  const properties = _.isEmpty(dataset.properties)
    ? `d.* EXCLUDE (${quoteIdentifier(dataset.geometry)})`
    : dataset.properties.map(property => `d.${quoteIdentifier(property)}`).join(', ')
  const output = clip ? `ST_Intersection(${geometry}, input.g)` : geometry
  return `WITH input AS (SELECT ST_GeomFromGeoJSON($1::VARCHAR) AS g)
SELECT ${properties}, ST_AsGeoJSON(${output}) AS kross_geometry
FROM ${getDatasetRelation(dataset)} AS d, input
WHERE ST_Intersects(${geometry}, input.g)
LIMIT $2`
}

function toFeature (row) {
  const geometry = row.kross_geometry
  return {
    type: 'Feature',
    geometry: _.isString(geometry) ? JSON.parse(geometry) : geometry,
    properties: _.omit(row, ['kross_geometry'])
  }
}

export async function createDuckDBProvider (app) {
  const config = _.get(app.get('providers'), 'DuckDB')
  if (!config) return null
  // Make sure we deal with plain objects and not node-config ones
  const { settings, s3, datasets: datasetsConfig = {} } = _.cloneDeep(config)

  const instance = await DuckDBInstance.create(':memory:', _.mapValues(settings, String))
  // Extensions and secrets are bound to the instance so that we setup them once
  const connection = await instance.connect()
  await connection.run('INSTALL spatial; LOAD spatial;')
  await connection.run('INSTALL httpfs; LOAD httpfs;')
  if (s3) await connection.run(createS3SecretStatement(s3))
  connection.closeSync()

  const datasets = _.map(datasetsConfig, (dataset, name) => ({ geometry: 'geometry', ...dataset, name }))
  debug(`DuckDB provider: found ${datasets.length} datasets`, _.map(datasets, 'name'))

  async function query (dataset, { geometry, limit, clip }) {
    const sql = getIntersectQuery(dataset, { clip })
    const parameters = [JSON.stringify(geometry), limit]
    debug(`${dataset.name}: running query`, sql)
    // One connection per query so that queries can run concurrently
    const connection = await instance.connect()
    try {
      const reader = await connection.runAndReadAll(sql, parameters)
      return reader.getRowObjectsJson().map(row => ({ source: dataset.name, feature: toFeature(row) }))
    } finally {
      connection.closeSync()
    }
  }

  return {
    name: 'DuckDB',

    capabilities ({ operation }) {
      return _.map(datasets, 'name')
    },

    async intersect ({ geometry, filter, limit, clip }) {
      const matchingDatasets = filterSources(datasets, filter)
      debug(`Requesting ${matchingDatasets.length} matching datasets`, _.map(matchingDatasets, 'name'))
      const results = await Promise.allSettled(matchingDatasets.map(dataset => query(dataset, { geometry, limit, clip })))
      const response = []
      results.forEach((result, index) => {
        // A failing dataset should not prevent others from answering
        if (result.status === 'fulfilled') response.push(...result.value)
        else app.logger.error(`DuckDB provider: query failed on dataset ${matchingDatasets[index].name}: ${result.reason}`)
      })
      return response
    },

    async close () {
      instance.closeSync()
    }
  }
}
