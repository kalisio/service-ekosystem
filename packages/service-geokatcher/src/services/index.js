import monitors from './monitors/monitors.service.js'

export default function (app) {
  app.configure(monitors)
}
