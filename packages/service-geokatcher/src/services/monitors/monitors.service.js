// We import the hooks for this service from the hooks.js file
import hooks from './monitors.hooks.js'
import { MongoDBService } from '@feathersjs/mongodb'
import monitorsModel from '../../models/monitors.model.js'

// Extra query operators allowed on top of the adapter defaults, needed to query
// monitors by name and geometry. $where is left out, it can run arbitrary JS.
const queryOperators = [
  '$and', '$nor', '$not',
  '$regex', '$options',
  '$exists', '$type',
  '$all', '$elemMatch', '$size',
  '$geoIntersects', '$geoWithin', '$near', '$nearSphere',
  '$geometry', '$maxDistance', '$minDistance', '$box', '$center', '$centerSphere', '$polygon'
]

export default function (app) {
  const Model = monitorsModel.createModel(app)
  const paginate = app.get('paginate')

  app.use('monitor', new MongoDBService({
    Model,
    paginate,
    operators: queryOperators,
    multi: ['remove', 'patch', 'update']
  }))
  app.service('monitor').hooks(hooks)
  monitorsModel.kano = app.get('kano')

  app.on('kano:ready', () => {
    monitorsModel.startExistingMonitors()
  })
}
