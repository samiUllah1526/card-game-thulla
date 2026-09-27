import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { INVALID_MOVE } from 'boardgame.io/core'
import { afterEach, describe, expect, it } from 'vitest'
import type { Server as BgioServer, State } from 'boardgame.io'
import Koa from 'koa'
import bodyParser from 'koa-bodyparser'
import { config } from '../config'
import { BhabhiThulla, createWaitingState } from '../games/bhabhi-thulla/game'
import type { BhabhiState } from '../games/bhabhi-thulla/types'
import { createAppRouter } from './appApi'
import type { AppStore } from './appStore'
import { linkOffer } from './linkOffer'
import { SqliteStorage } from './sqliteStorage'

/**
 * The host opens a few seats, can grow that list while people are arriving,
 * and the deal only includes the people who sat. A started or closed table
 * still refuses a new seat.
 */
describe('flexible table seats', () => {
  let dir = ''
  let server: Server | null = null

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => (error ? reject(error) : resolve()))
      })
    }
    server = null
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = ''
  })

  function open(seatCount: number) {
    dir = mkdtempSync(join(tmpdir(), 'thulla-seats-'))
    const storage = new SqliteStorage(join(dir, 'test.sqlite'))
    storage.connect()
    const waiting = createWaitingState({ numPlayers: config.game.maxPlayers, setupData: { seatCount } })
    storage.createMatch('m1', {
      initialState: asState(waiting),
      metadata: tableMeta(),
    })
    return { storage, waiting }
  }

  async function listen(store: AppStore) {
    const app = new Koa()
    app.use(bodyParser())
    app.use(async (ctx, next) => {
      const match = ctx.path.match(/^\/games\/[^/]+\/([^/]+)\/join$/)
      if (ctx.method !== 'POST' || !match) {
        await next()
        return
      }
      const body = ctx.request.body
      const raw =
        body && typeof body === 'object' && 'playerID' in body
          ? Number((body as { playerID?: unknown }).playerID)
          : NaN
      const block = store.joinBlock(decodeURIComponent(match[1]), Number.isFinite(raw) ? raw : undefined)
      if (!block) {
        ctx.body = { playerCredentials: 'new-seat' }
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
    app.use(createAppRouter(store).routes())
    server = createServer(app.callback())
    await new Promise<void>((resolve) => {
      server?.listen(0, '127.0.0.1', () => resolve())
    })
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    return `http://127.0.0.1:${port}`
  }

  it('keeps empty seats open, grows the list, then deals only the people who sat', async () => {
    const { storage, waiting } = open(4)
    const url = await listen(storage.getAppStore())

    const gate = await readJson<{ closed: boolean; started: boolean; seatCount: number }>(
      `${url}/api/matches/m1/gate`,
    )
    const watch = await readJson<{ seats: Array<{ id: number; name?: string }> }>(
      `${url}/api/matches/m1/watch`,
    )
    const openSeat = await postJoin(url, 1)
    const closedSeat = await postJoin(url, 4)

    expect(gate).toEqual({ closed: false, started: false, seatCount: 4 })
    expect(watch.seats.map((seat) => seat.id)).toEqual([0, 1, 2, 3])
    expect(watch.seats.some((seat) => !seat.name)).toBe(true)
    expect(openSeat.status).toBe(200)
    expect(closedSeat.status).toBe(403)
    expect(await closedSeat.json()).toEqual({ error: 'That seat is not open.' })
    expect(
      linkOffer({
        closed: false,
        started: false,
        missing: false,
        hasEmptySeat: true,
        reclaimed: false,
      }),
    ).toEqual({ sit: true, watch: true, ended: false })

    expect(callMove('addSeat', waiting, '0')).not.toBe(INVALID_MOVE)
    expect(waiting.seatCount).toBe(5)
    storage.setState('m1', asState(waiting))

    const grown = await postJoin(url, 4)
    const stillShut = await postJoin(url, 5)
    expect(grown.status).toBe(200)
    expect(stillShut.status).toBe(403)

    for (const id of ['0', '1', '2']) callMove('markSeated', waiting, id)
    expect(callMove('startGame', waiting, '0')).not.toBe(INVALID_MOVE)
    storage.setState('m1', asState(waiting))

    const late = await postJoin(url, 3)
    expect(late.status).toBe(403)
    expect(await late.json()).toEqual({ error: 'This game has already started.' })

    const playing = await readJson<{
      seats: Array<{ id: number }>
      G: { handCounts: Record<string, number> }
    }>(`${url}/api/matches/m1/watch`)
    expect(playing.seats.map((seat) => seat.id)).toEqual([0, 1, 2, 3, 4])
    expect(playing.G.handCounts['0']).toBeGreaterThan(0)
    expect(playing.G.handCounts['1']).toBeGreaterThan(0)
    expect(playing.G.handCounts['2']).toBeGreaterThan(0)
    expect(playing.G.handCounts['3']).toBe(0)
    expect(playing.G.handCounts['4']).toBe(0)
    expect(Object.values(playing.G.handCounts).reduce((sum, count) => sum + count, 0)).toBe(52)

    waiting.phase = 'finished'
    storage.setState('m1', asState(waiting))
    storage.getAppStore().closeMatch('m1', '0')
    const ended = await postJoin(url, 3)
    expect(ended.status).toBe(410)
    expect(await ended.json()).toEqual({ error: 'This table has ended.' })
  })
})

function callMove(name: 'startGame' | 'addSeat' | 'markSeated', G: BhabhiState, playerID: string) {
  const move = BhabhiThulla.moves?.[name]
  if (!move) throw new Error(name)
  const args = {
    G,
    playerID,
    ctx: { numPlayers: config.game.maxPlayers } as never,
    random: {
      Number: () => 0.42,
    },
  }
  if (typeof move === 'function') return move(args as never)
  return move.move(args as never)
}

function asState(G: BhabhiState): State {
  const seats = Array.from({ length: config.game.maxPlayers }, (_, index) => String(index))
  return {
    G,
    ctx: { numPlayers: config.game.maxPlayers, currentPlayer: '0', playOrder: seats } as State['ctx'],
    plugins: {},
    _undo: [],
    _redo: [],
    _stateID: 1,
  }
}

function tableMeta(): BgioServer.MatchData {
  const players: BgioServer.MatchData['players'] = {
    0: { id: 0, name: 'Aisha', credentials: 'cred-0' },
  }
  for (let id = 1; id < config.game.maxPlayers; id += 1) players[id] = { id }
  return {
    gameName: config.game.name,
    players,
    createdAt: 1,
    updatedAt: 1,
  }
}

function postJoin(url: string, playerID: number) {
  return fetch(`${url}/games/${config.game.name}/m1/join`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ playerID, playerName: 'Guest' }),
  })
}

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  expect(response.status).toBe(200)
  return response.json() as Promise<T>
}
