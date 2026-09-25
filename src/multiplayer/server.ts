import { Server } from 'boardgame.io/server'
import { randomBytes } from 'node:crypto'
import { BhabhiThulla } from '../games/bhabhi-thulla/game'

const port = Number(process.env.PORT ?? 8000)
const allowedOrigins = process.env.CLIENT_ORIGINS?.split(',') ?? ['*']

const server = Server({
  games: [BhabhiThulla],
  origins: allowedOrigins,
  apiOrigins: allowedOrigins,
  uuid: () => randomBytes(4).toString('base64url'),
})

server.run(port, () => {
  console.log(`Bhabhi Thulla server listening on http://localhost:${port}`)
})
