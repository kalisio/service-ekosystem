import { createServer } from './server.js'
import { logger } from './logger.js'

process.on('unhandledRejection', reason => logger.error('Unhandled Rejection %O', reason))

const server = createServer()
server.run()

export default server
