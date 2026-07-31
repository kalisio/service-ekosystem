import _ from 'lodash'

const DOLLAR = '$'
const DOT = '.'
const FULLWIDTH_DOLLAR = '＄' // U+FF04
const FULLWIDTH_DOT = '．' // U+FF0E

const replaceAll = (text, from, to) => text.split(from).join(to)

const escapeKey = (key) => replaceAll(replaceAll(key, DOLLAR, FULLWIDTH_DOLLAR), DOT, FULLWIDTH_DOT)
const unescapeKey = (key) => replaceAll(replaceAll(key, FULLWIDTH_DOLLAR, DOLLAR), FULLWIDTH_DOT, DOT)

// Rewrite every key in a value, recursively. Values are left untouched (a dot in a
// url is fine, only dots/$ in keys break MongoDB). Date/ObjectId/Buffer are skipped
// since rebuilding them from their keys would lose their content.
function rewriteKeys (value, rewrite) {
  if (_.isFunction(value) || _.isSymbol(value)) {
    throw new Error('A function or a symbol cannot be stored in the database')
  }
  if (_.isArray(value)) return value.map((item) => rewriteKeys(item, rewrite))
  if (_.isPlainObject(value)) {
    return Object.entries(value).reduce((result, [key, item]) => {
      result[rewrite(key)] = rewriteKeys(item, rewrite)
      return result
    }, {})
  }
  return value
}

// Make a value safe to store: '$' and '.' are replaced with '＄' and '．' in every key
export function escape (value) {
  return rewriteKeys(value, escapeKey)
}

// Restore a value read from the database: '＄' and '．' are replaced back with '$' and '.'
export function unescape (value) {
  return rewriteKeys(value, unescapeKey)
}

export default { escape, unescape }
