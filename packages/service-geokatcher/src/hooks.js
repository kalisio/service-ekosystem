// Application hooks that run for every service

export default {
  before: {
    all: [],
    find: [],
    get: [],
    create: [],
    update: [],
    patch: [],
    remove: []
  },

  after: {
    all: [],
    find: [],
    get: [],
    create: [],
    update: [],
    patch: [],
    remove: []
  },

  error: {
    all: [
      async (context) => {
        if (context.error && process.env.NODE_ENV !== 'test') {
          context.app.logger.error(`ERROR HOOK: Error in service [${context.path}]: ${context.error.message}${context.error.data ? `:\ndata : ${JSON.stringify(context.error.data)}` : ''}\n ${context.error.stack}`)
        }
      }
    ],
    find: [],
    get: [],
    create: [],
    update: [],
    patch: [],
    remove: []
  }
}
