import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Server, State } from 'boardgame.io'
import { listBotActions } from '../games/bhabhi-thulla/botActions'
import type { BhabhiState } from '../games/bhabhi-thulla/types'
import { SqliteStorage } from '../multiplayer/sqliteStorage'
import { BotService, type BotTableDirectory } from './service'
import { BotSeatStore } from './store'
import type { BotConnection, BotSnapshot, BotTransport } from './types'

function fakeState(partialG: Record<string, unknown> = {}): State {
  return {
    G: partialG,
    ctx: { numPlayers: 4, currentPlayer: '0', playOrder: ['0', '1', '2', '3'] } as State['ctx'],
    plugins: {},
    _undo: [],
    _redo: [],
    _stateID: 1,
  }
}

function meta(): Server.MatchData {
  return {
    gameName: 'thulla-express',
    players: {
      0: { id: 0, name: 'Host', credentials: 'cred-host' },
      1: { id: 1 },
      2: { id: 2 },
      3: { id: 3, name: 'Bea', credentials: 'cred-bea' },
    },
    createdAt: 1,
    updatedAt: 1,
  }
}

class FakeConnection implements BotConnection {
  calls: string[] = []
  private listener: ((snapshot: BotSnapshot | null) => void) | null = null

  constructor(readonly playerID: string) {}

  start(): void {
    this.calls.push('start')
    this.listener?.({
      G: { started: false, seated: {}, bots: {} } as BhabhiState,
      isConnected: true,
    })
  }

  subscribe(listener: (snapshot: BotSnapshot | null) => void): () => void {
    this.listener = listener
    return () => {
      this.listener = null
    }
  }

  noteBot(difficulty: string | null): void {
    this.calls.push(`note:${difficulty}`)
  }

  markSeated(): void {
    this.calls.push('sit')
  }

  dispatch(): void {}

  stop(): void {
    this.calls.push('stop')
  }
}

function fakeTransport() {
  const calls: string[] = []
  const connections: FakeConnection[] = []
  const transport: BotTransport = {
    async join(_matchID, playerID, playerName) {
      calls.push(`join:${playerID}:${playerName}`)
      return { credentials: `secret-${playerID}` }
    },
    async leave(_matchID, playerID, credentials) {
      calls.push(`leave:${playerID}:${credentials}`)
    },
    connect(session) {
      calls.push(`connect:${session.playerID}`)
      const connection = new FakeConnection(session.playerID)
      connections.push(connection)
      return connection
    },
  }
  return { calls, connections, transport }
}

describe('BotService', () => {
  let dir = ''

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = ''
  })

  function open() {
    dir = mkdtempSync(join(tmpdir(), 'thulla-bots-'))
    const storage = new SqliteStorage(join(dir, 'test.sqlite'))
    storage.connect()
    storage.createMatch('m1', {
      initialState: fakeState({
        phase: 'waiting',
        started: false,
        hostID: '0',
        seatCount: 4,
        seated: { '0': true },
        bots: {},
      }),
      metadata: meta(),
    })
    const app = storage.getAppStore()
    const released: string[] = []
    const tables: BotTableDirectory = {
      lobby: (matchID) => app.lobby(matchID),
      occupant: (matchID, playerID) => app.occupant(matchID, playerID),
      takenNames: (matchID) => app.takenNames(matchID),
      releaseMember: (matchID, playerID) => {
        released.push(`${matchID}:${playerID}`)
        app.releaseMember(matchID, playerID)
      },
      bots: (matchID) => app.bots(matchID),
      seated: (matchID) => app.seated(matchID),
    }
    const transport = fakeTransport()
    const seats = new BotSeatStore(storage.database())
    const service = new BotService({
      seats,
      tables,
      transport: transport.transport,
      listActions: listBotActions,
      clock: { wait: async () => {} },
      ackMs: 0,
    })
    return { storage, app, service, seats, released, ...transport }
  }

  it('fills seats without returning credentials', async () => {
    const { service, seats, calls } = open()
    const result = await service.fill({
      matchID: 'm1',
      actorID: '0',
      seats: ['1', '2'],
      difficulty: 'shark',
    })
    expect(result.seats.map((seat) => seat.playerID)).toEqual(['1', '2'])
    expect(result.seats.map((seat) => seat.difficulty)).toEqual(['shark', 'shark'])
    const saved = seats.get('m1', '1')
    expect(saved?.credentials).toBe('secret-1')
    expect(JSON.stringify(result)).not.toContain('secret-1')
    expect(calls).toContain('join:1:Rafi')
    expect(calls).toContain('join:2:Meera')
  })

  it('refuses a guest, a started table, and the host seat', async () => {
    const { service, storage } = open()
    await expect(
      service.seat({ matchID: 'm1', actorID: '1', seat: '2', difficulty: 'rookie' }),
    ).rejects.toThrow(/host/i)
    await expect(
      service.seat({ matchID: 'm1', actorID: '0', seat: '0', difficulty: 'rookie' }),
    ).rejects.toThrow(/host seat/i)
    storage.setState(
      'm1',
      fakeState({ phase: 'preTrick', started: true, hostID: '0', seatCount: 4 }),
    )
    await expect(
      service.seat({ matchID: 'm1', actorID: '0', seat: '1', difficulty: 'rookie' }),
    ).rejects.toThrow(/before the deal/i)
  })

  it('replaces a seated person and forgets their account', async () => {
    const { service, app, calls, released } = open()
    const user = app.signup('bea@example.com', 'secret123', 'Bea')
    app.noteSeat('m1', '3', user.user.id)
    const result = await service.seat({
      matchID: 'm1',
      actorID: '0',
      seat: '3',
      difficulty: 'mastermind',
    })
    expect(result).toMatchObject({ playerID: '3', difficulty: 'mastermind' })
    expect(JSON.stringify(result)).not.toContain('secret')
    expect(calls).toContain('leave:3:cred-bea')
    expect(released).toContain('m1:3')
    expect(() => app.reclaimSeat('m1', user.user.id)).toThrow(/not seated/i)
  })

  it('frees a bot seat and can restore the ones still in the lobby', async () => {
    const { service, seats, storage, calls, connections } = open()
    await service.fill({
      matchID: 'm1',
      actorID: '0',
      seats: ['1', '2'],
      difficulty: 'rookie',
    })
    await service.clear({ matchID: 'm1', actorID: '0', seat: '1' })
    expect(seats.get('m1', '1')).toBeNull()
    expect(calls).toContain('leave:1:secret-1')
    expect(connections[0]?.calls).toContain('note:null')

    const table = meta()
    table.players[2] = { id: 2, name: 'Meera', credentials: 'secret-2' }
    storage.setMetadata('m1', table)
    const again = fakeTransport()
    const restored = new BotService({
      seats,
      tables: {
        lobby: (matchID) => storage.getAppStore().lobby(matchID),
        occupant: (matchID, playerID) => storage.getAppStore().occupant(matchID, playerID),
        takenNames: (matchID) => storage.getAppStore().takenNames(matchID),
        releaseMember: () => {},
        bots: () => ({}),
        seated: () => ({}),
      },
      transport: again.transport,
      listActions: listBotActions,
      clock: { wait: async () => {} },
      ackMs: 0,
    })
    await restored.restore()
    expect(again.calls).toContain('connect:2')
    expect(again.calls.some((call) => call.startsWith('join'))).toBe(false)
    expect(seats.get('m1', '2')?.credentials).toBe('secret-2')
  })
})
