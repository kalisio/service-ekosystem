module.exports = {
  email: process.env.TRACCAR_EMAIL,
  password: process.env.TRACCAR_PASSWORD,
  traccar_url: process.env.TRACCAR_URL,

  // this is not a geojson feature, but a JSON object from traccar
  // e.i {query: {"deviceId" : 3 }, subLayer: "KALISIO_TEAM"}
  filters: [
    { query: {}, subLayer: 'KALISIO_TEAM' }
  ],

  update_interval: 200
}
