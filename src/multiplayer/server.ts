import { Server } from 'boardgame.io/server'
import type { IncomingMessage } from 'node:http'
import { randomBytes } from 'node:crypto'
import { Readable } from 'node:stream'
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
    const rawBody = await readRequestBody(ctx.req)
    ctx.req = replayRequestBody(ctx.req, rawBody)
    const playerID = playerIDFromBody(rawBody)
    const block = appStore.joinBlock(decodeURIComponent(match[1]), playerID)
    if (!block) {
      await next()
      return
    }
    ctx.status = block === 'closed' ? 410 : 403
    ctx.body = {
      error:
        block === 'closed'
          ? 'This table has ended.'
          : block === 'unopened'
            ? 'That seat is not open.'
            : 'This game has already started.',
    }
  })
}

async function readRequestBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

/** Put the bytes back so boardgame.io's own parser can read the same request. */
function replayRequestBody(req: IncomingMessage, raw: Buffer): IncomingMessage {
  const replay = Readable.from(raw) as IncomingMessage
  replay.headers = req.headers
  replay.method = req.method
  replay.url = req.url
  return replay
}

function playerIDFromBody(raw: Buffer): number | undefined {
  if (!raw.length) return undefined
  try {
    const parsed = JSON.parse(raw.toString('utf8')) as { playerID?: unknown }
    const playerID = Number(parsed.playerID)
    return Number.isFinite(playerID) ? playerID : undefined
  } catch {
    return undefined
  }
}
server.app.use(createAppRouter(appStore).routes())

server.run(port, () => {
  console.log(`${config.game.title} server listening on http://localhost:${port}`)
  console.log(`Match store: ${describeMatchStore()}`)
})
