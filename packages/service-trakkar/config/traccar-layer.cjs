module.exports = function ({ wmtsUrl, tmsUrl, wmsUrl, wcsUrl, k2Url, s3Url }) {
  return [{
    name: 'Layers.TRACCAR',
    description: 'Layers.TRACCAR_DESCRIPTION',
    i18n: {
      fr: {
        Layers: {
          TRACCAR: 'Traccar',
          TRACCAR_DESCRIPTION: 'Réseau Traccar',
          TRACCAR_KALISIO_TEAM: 'Equipe Kalisio'
        }
      },
      en: {
        Layers: {
          TRACCAR: 'Traccar',
          TRACCAR_DESCRIPTION: 'Traccar Network',
          TRACCAR_KALISIO_TEAM: 'Kalisio Team'
        }
      }
    },
    type: 'OverlayLayer',
    service: 'tracking',
    featureLabel: ['name', 'name:en', 'name:fr'],
    filters: [
      {
        label: 'Layers.TRACCAR_KALISIO_TEAM',
        isActive: false,
        inactive: { subLayer: 'KALISIO_TEAM' },
        active: {}
      }
    ],

    leaflet: {
      type: 'geoJson',
      realtime: true,
      tiled: true,
      minZoom: 3,
      cluster: {
        maxClusterRadius: 28,
        disableClusteringAtZoom: 18
      },
      style: {
        point: {
          shape: 'circle',
          radius: 15,
          opacity: 1,

          // #bfb3b2 -> grey
          // #eb4034 -> red
          // #c7c03a -> yellow
          // #2aa32e -> green

          color: `<% 
                if (moment.utc(properties.lastUpdate).isBefore(moment().subtract(24, 'hours').utc())) { %>#bfb3b2<% } 
                else if (moment.utc(properties.lastUpdate).isBefore(moment().subtract(2, 'hours').utc())) { %>#eb4034<% } 
                else if (moment.utc(properties.lastUpdate).isBefore(moment().subtract(15, 'minutes').utc())) { %>#c7c03a<% } 
                else { %>#2aa32e<% } 
            %>`,
          stroke: {
            color: '#f2eae2',
            width: 2
          },
          icon: {
            color: '#f2eae2',
            classes: 'fa fa-satellite-dish'
          }
        }
      },
      //   template: ['style.point.color', 'style.point.stroke.color', 'style.point.icon.color', 'style.point.text.label'],
      template: ['style.point.color'],
      tooltip: {
        property: 'name'
      },
      popup: {
        pick: [
          'name'
        ]
      }
    //   tooltip: {
    //     template: `<%= properties.name %></br>
    //                 <% if (_.has(properties, 'value')) { %><%= Units.format(properties.value, 'nsvh') %></br>
    //                 <%= Time.format(properties.measureDateFormatted, 'time.long') + ' - ' + Time.format(properties.measureDateFormatted, 'date.short') %><% } %>`
    //   }
    }
  }]
}
