import { Server } from 'boardgame.io/server'
import { randomBytes } from 'node:crypto'
import { config } from '../config'
import { BhabhiThulla } from '../games/bhabhi-thulla/game'
import { setPeekPasswordResolver } from '../games/bhabhi-thulla/peek'
import { peekPassword } from '../games/bhabhi-thulla/peekEnv'
import { loadEnv } from './loadEnv'
import { createMatchStore, describeMatchStore } from './matchStore'

loadEnv()
setPeekPasswordResolver(peekPassword)

const port = Number(process.env.PORT ?? config.server.defaultPort)
const allowedOrigins = process.env.CLIENT_ORIGINS?.split(',') ?? [...config.server.defaultOrigins]
const db = createMatchStore()

const server = Server({
  games: [BhabhiThulla],
  origins: allowedOrigins,
  apiOrigins: allowedOrigins,
  uuid: () => randomBytes(4).toString('base64url'),
  db,
})

server.run(port, () => {
  console.log(`${config.game.title} server listening on http://localhost:${port}`)
  console.log(`Match store: ${describeMatchStore()}`)
})
