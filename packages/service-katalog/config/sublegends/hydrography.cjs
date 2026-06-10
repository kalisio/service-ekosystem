module.exports = function () {
  return [{
    name: 'Sublegends.HYDROGRAPHY',
    i18n: {
      fr: {
        Sublegends: {
          HYDROGRAPHY: 'Hydrographie'
        }
      },
      en: {
        Sublegends: {
          HYDROGRAPHY: 'Hydrography'
        }
      }
    },
    headerClass: 'bg-grey-3 text-weight-regular',
    options: { open: true, filter: { type: 'OverlayLayer', tags: { $in: ['hydrography'] } } }
  }]
}
