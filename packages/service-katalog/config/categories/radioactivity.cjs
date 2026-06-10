module.exports = function ({ domain }) {
  return [{
    name: 'Categories.RADIOACTIVITY_LAYERS',
    i18n: {
      fr: {
        Categories: {
          RADIOACTIVITY_LAYERS: 'Radioactivité'
        }
      },
      en: {
        Categories: {
          RADIOACTIVITY_LAYERS: 'Radioactivity'
        }
      }
    },
    icon: 'las la-radiation',
    options: { exclusive: false, filter: { type: 'OverlayLayer', tags: { $in: ['radioactivity'] } } }
  }]
}
