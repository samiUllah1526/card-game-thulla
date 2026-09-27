import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import Koa from 'koa'
import type { Server as BgioServer, State } from 'boardgame.io'
import { config } from '../config'
import { createAppRouter } from './appApi'
import type { AppStore } from './appStore'
import { linkOffer } from './linkOffer'
import { SqliteStorage } from './sqliteStorage'

/**
 * The creator's browser closes or the network drops, then they open the join
 * link again with no seat secret in hand. These tests hit the same HTTP routes
 * the link uses and apply the same Sit down / Watch rules.
 */
describe('rejoin the link after a drop', () => {
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

  function open() {
    dir = mkdtempSync(join(tmpdir(), 'thulla-rejoin-'))
    const storage = new SqliteStorage(join(dir, 'test.sqlite'))
    storage.connect()
    storage.createMatch('m1', {
      initialState: waitingState(),
      metadata: tableMeta(),
    })
    return storage
  }

  async function listen(store: AppStore) {
    const app = new Koa()
    app.use(async (ctx, next) => {
      const match = ctx.path.match(/^\/games\/[^/]+\/([^/]+)\/join$/)
      if (ctx.method !== 'POST' || !match) {
        await next()
        return
      }
      const block = store.joinBlock(decodeURIComponent(match[1]))
      if (!block) {
        ctx.body = { playerCredentials: 'new-seat' }
        return
      }
      ctx.status = block === 'closed' ? 410 : 403
      ctx.body = {
        error: block === 'closed' ? 'This table has ended.' : 'This game has already started.',
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

  it('keeps Sit down enabled while the lobby is open and the seat secret is gone', async () => {
    const url = await listen(open().getAppStore())

    const gate = await readJson<{ closed: boolean; started: boolean }>(`${url}/api/matches/m1/gate`)
    const watch = await readJson<{ seats: Array<{ id: number; name?: string }> }>(
      `${url}/api/matches/m1/watch`,
    )
    const join = await fetch(`${url}/games/${config.game.name}/m1/join`, { method: 'POST' })

    expect(gate).toEqual({ closed: false, started: false })
    expect(watch.seats.some((seat) => !seat.name)).toBe(true)
    expect(join.status).toBe(200)
    expect(
      linkOffer({
        closed: gate.closed,
        started: gate.started,
        missing: false,
        hasEmptySeat: watch.seats.some((seat) => !seat.name),
        reclaimed: false,
      }),
    ).toEqual({ sit: true, watch: true, ended: false })
  })

  it('offers only Watch after the deal starts when the browser lost the seat', async () => {
    const storage = open()
    storage.setState('m1', startedState())
    const url = await listen(storage.getAppStore())

    const gate = await readJson<{ closed: boolean; started: boolean }>(`${url}/api/matches/m1/gate`)
    const watch = await fetch(`${url}/api/matches/m1/watch`)
    const join = await fetch(`${url}/games/${config.game.name}/m1/join`, { method: 'POST' })
    const reclaim = await fetch(`${url}/api/matches/m1/reclaim`, { method: 'POST' })

    expect(gate).toEqual({ closed: false, started: true })
    expect(watch.status).toBe(200)
    expect(join.status).toBe(403)
    expect(reclaim.status).toBe(401)
    expect(
      linkOffer({
        closed: false,
        started: true,
        missing: false,
        hasEmptySeat: true,
        reclaimed: false,
      }),
    ).toEqual({ sit: false, watch: true, ended: false })
  })

  it('sits the signed-in creator back down after the browser drops', async () => {
    const storage = open()
    const store = storage.getAppStore()
    const creator = store.signup('aisha@example.com', 'secret123', 'Aisha')
    store.noteSeat('m1', '0', creator.user.id)
    const url = await listen(store)
    const cookie = `${config.auth.cookieName}=${creator.token}`

    const openReclaim = await fetch(`${url}/api/matches/m1/reclaim`, {
      method: 'POST',
      headers: { Cookie: cookie },
    })
    const openSeat = (await openReclaim.json()) as { playerID: string; credentials: string }
    expect(openReclaim.status).toBe(200)
    expect(openSeat).toMatchObject({ playerID: '0', credentials: 'cred-0', playerName: 'Aisha' })
    expect(
      linkOffer({
        closed: false,
        started: false,
        missing: false,
        hasEmptySeat: true,
        reclaimed: true,
      }),
    ).toEqual({ sit: false, watch: false, ended: false })

    storage.setState('m1', startedState())

    const startedReclaim = await fetch(`${url}/api/matches/m1/reclaim`, {
      method: 'POST',
      headers: { Cookie: cookie },
    })
    expect(startedReclaim.status).toBe(200)
    expect(
      linkOffer({
        closed: false,
        started: true,
        missing: false,
        hasEmptySeat: false,
        reclaimed: true,
      }),
    ).toEqual({ sit: false, watch: false, ended: false })

    const stranger = await fetch(`${url}/games/${config.game.name}/m1/join`, { method: 'POST' })
    const watch = await fetch(`${url}/api/matches/m1/watch`)
    expect(stranger.status).toBe(403)
    expect(watch.status).toBe(200)
  })
})

function waitingState(): State {
  return stateWith({ started: false, phase: 'waiting' })
}

function startedState(): State {
  return stateWith({ started: true, phase: 'preTrick' })
}

function stateWith(partialG: Record<string, unknown>): State {
  return {
    G: { hostID: '0', left: [], hands: { '0': [], '1': [], '2': [] }, ...partialG },
    ctx: { numPlayers: 3, currentPlayer: '0', playOrder: ['0', '1', '2'] } as State['ctx'],
    plugins: {},
    _undo: [],
    _redo: [],
    _stateID: 1,
  }
}

function tableMeta(): BgioServer.MatchData {
  return {
    gameName: 'thulla-express',
    players: {
      0: { id: 0, name: 'Aisha', credentials: 'cred-0' },
      1: { id: 1 },
      2: { id: 2 },
    },
    createdAt: 1,
    updatedAt: 1,
  }
}

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  expect(response.status).toBe(200)
  return response.json() as Promise<T>
}
