module.exports = function () {
  return [{
    name: 'Sublegends.RADIOACTIVITY',
    i18n: {
      fr: {
        Sublegends: {
          RADIOACTIVITY: 'Radioactivité'
        }
      },
      en: {
        Sublegends: {
          RADIOACTIVITY: 'Radioactivity'
        }
      }
    },
    headerClass: 'bg-grey-3 text-weight-regular',
    options: { open: true, filter: { type: 'OverlayLayer', tags: { $in: ['radioactivity'] } } }
  }]
}
