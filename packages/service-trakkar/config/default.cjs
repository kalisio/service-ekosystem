module.exports = {
  email: process.env.TRACCAR_EMAIL || 'traccar@exemple.com',
  password: process.env.TRACCAR_PASSWORD || 'password',
  traccar_url: process.env.TRACCAR_URL || 'http://localhost:8082',
  port: process.env.PORT || 8080,

  // this is not a geojson feature, but a JSON object from traccar
  // e.i {query: {"deviceId" : 3 }, subLayer: "KALISIO_TEAM"}
  filters: [
    { query: {}, subLayer: 'KALISIO_TEAM' }
  ],

  update_interval: 200
}
