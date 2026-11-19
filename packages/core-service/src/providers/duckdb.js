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
  const geometry = row.geom
  return {
    type: 'Feature',
    geometry: _.isString(geometry) ? JSON.parse(geometry) : geometry,
    properties: _.omit(row, ['geom'])
  }
}

const CMP = { '=': '=', '<>': '<>', '<': '<', '<=': '<=', '>': '>', '>=': '>=' }
const ARITH = { '+': '+', '-': '-', '*': '*', '/': '/', '%': '%', div: '/' }

function quoteIdent (name) {
  if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(name)) throw new Error(`Invalid property name: ${name}`)
  return name.split('.').map(p => `"${p}"`).join('.')
}

function cql2sql (query, opts = {}) {
  const params = []
  const ident = opts.mapProp || quoteIdent
  const ph = v => { params.push(v); return opts.placeholder ? opts.placeholder(params.length) : '?' }

  const isOp = n => n && typeof n === 'object' && !Array.isArray(n) && typeof n.op === 'string'

  function expr (n) {
    if (Array.isArray(n)) throw new Error('Unexpected array')
    if (n === null || typeof n !== 'object') return ph(n) // literal
    if (n.property !== undefined) return ident(n.property)
    if (n.timestamp !== undefined) return ph(n.timestamp)
    if (n.date !== undefined) return ph(n.date)
    if (n.bbox) return ph(JSON.stringify(n.bbox))
    if ((n.type && n.coordinates) || n.type === 'GeometryCollection') return `ST_GeomFromGeoJSON(${ph(JSON.stringify(n))})`
    if (isOp(n)) return op(n)
    throw new Error('Unsupported node: ' + JSON.stringify(n))
  }

  function op (n) {
    const a = n.args || []
    const o = n.op.toLowerCase()
    switch (o) {
      case 'and': case 'or':
        return '(' + a.map(op_ => expr(op_)).join(` ${o.toUpperCase()} `) + ')'
      case 'not': return `(NOT ${expr(a[0])})`
      case '=': case '<>': case '<': case '<=': case '>': case '>=':
        return `(${expr(a[0])} ${CMP[o]} ${expr(a[1])})`
      case '+': case '-': case '*': case '/': case '%': case 'div':
        return `(${expr(a[0])} ${ARITH[o]} ${expr(a[1])})`
      case '^': return `POWER(${expr(a[0])}, ${expr(a[1])})`
      case 'isnull': return `(${expr(a[0])} IS NULL)`
      case 'like': return `(${expr(a[0])} LIKE ${expr(a[1])})`
      case 'between':
        return `(${expr(a[0])} BETWEEN ${expr(a[1])} AND ${expr(a[2])})`
      case 'in':
        if (!Array.isArray(a[1]) || !a[1].length) throw new Error('IN needs non-empty list')
        return `(${expr(a[0])} IN (${a[1].map(expr).join(', ')}))`
      case 'casei': return `LOWER(${expr(a[0])})`
      case 'accenti': return `UNACCENT(${expr(a[0])})`
      case 'a_contains': return `(${expr(a[0])} @> ${expr(a[1])})`
      case 'a_containedby': return `(${expr(a[0])} <@ ${expr(a[1])})`
      case 'a_overlaps': return `(${expr(a[0])} && ${expr(a[1])})`
      case 'a_equals': return `(${expr(a[0])} = ${expr(a[1])})`
      case 's_intersects': case 's_equals': case 's_disjoint': case 's_touches':
      case 's_within': case 's_overlaps': case 's_crosses': case 's_contains':
        return `ST_${o.slice(2).replace(/^./, c => c.toUpperCase())}(${expr(a[0])}, ${expr(a[1])})`
      default:
        throw new Error(`Unsupported operator: ${n.op}`)
    }
  }

  return { sql: expr(query), params }
}

function getOverlayQuery (datasets, overlay) {
  const sql = []
  const params = []

  sql.push('SELECT')
  if (overlay.type === 'cql2-json') {
    const candidates = filterSources(datasets, overlay.value.source)
    const dataset = candidates[0]
    const { sql: filterSql, params: filterParams } = cql2sql(overlay.value.query)
    sql.push(`  overlay.${dataset.geometry} AS geom`)
    sql.push(`FROM ${getDatasetRelation(dataset)} AS overlay`)
    sql.push(`WHERE ${filterSql}`)
    params.push(...filterParams)
  } else if (overlay.type === 'geometry') {
    sql.push('  ST_GeomFromGeoJSON($1::VARCHAR) AS geom')
    params.push(JSON.stringify(overlay.value))
  }

  return { sql, params }
}

function getOutputQuery (datasets, output) {
  const sql = []
  const params = []

  const candidates = filterSources(datasets, output.source)
  const dataset = candidates[0]
  sql.push('SELECT')
  sql.push(`  ST_AsGeoJSON(output.${dataset.geometry}) AS geom`)
  dataset.properties.forEach((prop) => {
    sql.push(`, ${prop}`)
  })
  sql.push(`FROM ${getDatasetRelation(dataset)} AS output`)

  return { sql, params }
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
  // if (config.enableStats) {
  //   await connection.run('INSTALL http_stats FROM community; LOAD http_stats;')
  // }
  if (s3) await connection.run(createS3SecretStatement(s3))
  connection.closeSync()

  const datasets = _.map(datasetsConfig, (dataset, name) => ({ geometry: 'geometry', ...dataset, name }))
  debug(`DuckDB provider: found ${datasets.length} datasets`, _.map(datasets, 'name'))

  return {
    name: 'DuckDB',

    capabilities ({ operation }) {
      return _.map(datasets, 'name')
    },

    // async listCollections () {
    //   return datasets
    // },

    async intersect ({ output, overlay, limit, profile }) {
      const sql = []
      const params = []

      const { sql: overlaySql, params: overlayParams } = getOverlayQuery(datasets, overlay)
      const { sql: outputSql, params: outputParams } = getOutputQuery(datasets, output)

      if (profile === 'explain') sql.push('EXPLAIN')
      else if (profile === 'analyze') sql.push('EXPLAIN ANALYZE')
      sql.push('WITH overlay AS (')
      sql.push(...overlaySql.map((sql) => `  ${sql}`))
      sql.push(')')
      sql.push(...outputSql)
      sql.push('JOIN overlay ON ST_Intersects(output.geom, overlay.geom)')
      params.push(...overlayParams, ...outputParams)

      const fullSql = sql.join('\n')
      debug(fullSql)

      // One connection per query so that queries can run concurrently
      const connection = await instance.connect()
      try {
        const reader = await connection.runAndReadAll(fullSql, params)
        if (profile) {
          debug(reader.getRowObjects().map(row => row.explain_value).join(''))
          return []
        }
        return reader.getRowObjects().map(row => ({ feature: toFeature(row), source: output.source }))
      } finally {
        connection.closeSync()
      }
    },

    async close () {
      instance.closeSync()
    },

    async forwardGeocode ({ coordinates }) {

    },

    async reverseGeocode () {
    }
  }
}
