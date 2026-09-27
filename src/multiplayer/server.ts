import { Server } from 'boardgame.io/server'
import { randomBytes } from 'node:crypto'
import { config } from '../config'
import { BhabhiThulla } from '../games/bhabhi-thulla/game'
import { setPeekPasswordResolver } from '../games/bhabhi-thulla/peek'
import { peekPassword } from '../games/bhabhi-thulla/peekEnv'
import { createAppRouter } from './appApi'
import { loadEnv } from './loadEnv'
import { createMatchStore, describeMatchStore } from './matchStore'
import { SqliteStorage } from './sqliteStorage'

loadEnv()
setPeekPasswordResolver(peekPassword)

const port = Number(process.env.PORT ?? config.server.defaultPort)
const allowedOrigins = process.env.CLIENT_ORIGINS?.split(',') ?? [...config.server.defaultOrigins]
const db = createMatchStore()
if (db instanceof SqliteStorage) db.connect()

const server = Server({
  games: [BhabhiThulla],
  origins: allowedOrigins,
  apiOrigins: allowedOrigins,
  uuid: () => randomBytes(4).toString('base64url'),
  db,
})

const appStore = db instanceof SqliteStorage ? db.getAppStore() : null
if (appStore) {
  server.app.middleware.unshift(async (ctx, next) => {
    if (ctx.method !== 'POST') {
      await next()
      return
    }
    const match = ctx.path.match(/^\/games\/[^/]+\/([^/]+)\/join$/)
    if (!match) {
      await next()
      return
    }
    const block = appStore.joinBlock(decodeURIComponent(match[1]))
    if (!block) {
      await next()
      return
    }
    ctx.status = block === 'closed' ? 410 : 403
    ctx.body = {
      error: block === 'closed' ? 'This table has ended.' : 'This game has already started.',
    }
  })
}
server.app.use(createAppRouter(appStore).routes())

server.run(port, () => {
  console.log(`${config.game.title} server listening on http://localhost:${port}`)
  console.log(`Match store: ${describeMatchStore()}`)
})
