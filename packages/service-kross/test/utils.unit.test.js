import { describe, it, expect } from 'vitest'
import { filterSources, toGeometry, quoteIdentifier, quoteLiteral } from '../src/utils.js'
import { createS3SecretStatement, getDatasetRelation, getIntersectQuery } from '../src/providers/duckdb.js'

describe('kross:utils', () => {
  it('filters sources', () => {
    const sources = [{ name: 'communes' }, { name: 'departements' }, { name: 'zones/inondables' }]
    expect(filterSources(sources, '*')).toHaveLength(3)
    expect(filterSources(sources, 'comm*')).toEqual([{ name: 'communes' }])
    expect(filterSources(sources, '{communes,departements}')).toHaveLength(2)
    expect(filterSources(sources, 'zones/*')).toEqual([{ name: 'zones/inondables' }])
  })

  it('extracts geometries', () => {
    const point = { type: 'Point', coordinates: [1, 2] }
    expect(toGeometry(point)).toEqual(point)
    expect(toGeometry({ type: 'Feature', geometry: point })).toEqual(point)
    expect(toGeometry({ type: 'GeometryCollection', geometries: [point] })).toBeTruthy()
    expect(toGeometry({ type: 'FeatureCollection', features: [] })).toBeNull()
    expect(toGeometry({ type: 'Point' })).toBeNull()
    expect(toGeometry(null)).toBeNull()
  })

  it('quotes SQL', () => {
    expect(quoteIdentifier('na"me')).toBe('"na""me"')
    expect(quoteLiteral("s3://b/l'x.parquet")).toBe("'s3://b/l''x.parquet'")
  })
})

describe('kross:duckdb:sql', () => {
  it('builds the S3 secret', () => {
    const sql = createS3SecretStatement({ endpoint: 's3.fr-par.scw.cloud', region: 'fr-par', accessKeyId: 'key', secretAccessKey: 'secret', urlStyle: 'path', useSsl: true })
    expect(sql).toBe("CREATE OR REPLACE SECRET kross_s3 (TYPE s3, KEY_ID 'key', SECRET 'secret', REGION 'fr-par', ENDPOINT 's3.fr-par.scw.cloud', URL_STYLE 'path', USE_SSL true)")
  })

  it('builds dataset relations', () => {
    expect(getDatasetRelation({ url: 's3://bucket/data.parquet' })).toBe("read_parquet('s3://bucket/data.parquet')")
    expect(getDatasetRelation({ url: 's3://bucket/data/*.parquet' })).toBe("read_parquet('s3://bucket/data/*.parquet')")
    expect(getDatasetRelation({ url: 's3://bucket/data.geojson' })).toBe("ST_Read('s3://bucket/data.geojson')")
    expect(getDatasetRelation({ relation: 'my_view' })).toBe('my_view')
    expect(() => getDatasetRelation({ url: 'x', format: 'xls' })).toThrow()
  })

  it('builds intersection queries', () => {
    const query = getIntersectQuery({ url: 'a.parquet', geometry: 'geom', properties: ['id'] }, { clip: true })
    expect(query).toContain('SELECT d."id", ST_AsGeoJSON(ST_Intersection(d."geom", input.g))')
    expect(query).toContain('LIMIT $2')
    const allQuery = getIntersectQuery({ url: 'a.parquet', geometry: 'geom' }, { clip: false })
    expect(allQuery).toContain('SELECT d.* EXCLUDE ("geom"), ST_AsGeoJSON(d."geom")')
  })
})
