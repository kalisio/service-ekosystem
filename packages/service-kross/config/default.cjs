const path = require('node:path')
const winston = require('winston')

const host = process.env.HOSTNAME || 'localhost'
const port = process.env.PORT || 8081
const apiPath = process.env.API_PREFIX || '/api'
/* please refer to https://web.dev/articles/how-to-use-local-https for setup */
const https = null
const baseUrl = process.env.BASE_URL || (https ? `https://${host}:${port}${apiPath}` : `http://${host}:${port}${apiPath}`)

module.exports = {
  host,
  port,
  https,
  baseUrl,
  apiPath,
  // Input geometries can be large polygons
  bodyParser: {
    json: { limit: process.env.BODY_LIMIT || '10mb' }
  },
  paginate: {
    default: { intersect: 1000 },
    max: { intersect: 10000 }
  },
  providers: {
    // If value is false-ish the provider won't be instanciated
    // DuckDB: {
    //   // DuckDB instance settings, see https://duckdb.org/docs/stable/configuration/overview
    //   settings: { threads: '4', memory_limit: '1GB' },
    //   // Object storage access, mapped to a DuckDB S3 secret
    //   s3: {
    //     endpoint: process.env.S3_ENDPOINT, // host[:port] without the scheme, e.g. s3.fr-par.scw.cloud
    //     region: process.env.S3_REGION,
    //     accessKeyId: process.env.S3_ACCESS_KEY || process.env.S3_ACCESS_KEY_ID,
    //     secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    //     urlStyle: 'path'
    //   },
    //   // Each key is exposed as a source
    //   datasets: {
    //     communes: {
    //       url: `s3://${process.env.S3_BUCKET}/admin-express/communes.parquet`, // anything DuckDB can read: s3://, https://, local path, globs
    //       format: 'parquet', // or 'gdal' (ST_Read) for GeoJSON, GeoPackage, Shapefile...
    //       geometry: 'geometry', // geometry column name
    //       properties: ['insee_com', 'nom'] // optional subset of returned properties, all by default
    //     }
    //   }
    // }
  },
  logs: {
    Console: {
      format: winston.format.combine(winston.format.colorize(), winston.format.simple()),
      level: (process.env.NODE_ENV === 'development' ? 'verbose' : 'info')
    },
    DailyRotateFile: {
      format: winston.format.json(),
      dirname: path.join(__dirname, '..', 'logs'),
      filename: 'service-kross-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: '30d'
    }
  }
}
