import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteStorage } from './sqliteStorage'
import type { Server, State } from 'boardgame.io'

function fakeState(id: number): State {
  return {
    G: { n: id },
    ctx: { numPlayers: 3, currentPlayer: '0', playOrder: ['0', '1', '2'] } as State['ctx'],
    plugins: {},
    _undo: [],
    _redo: [],
    _stateID: id,
  }
}

function fakeMeta(partial: Partial<Server.MatchData> = {}): Server.MatchData {
  return {
    gameName: 'thulla-express',
    players: { 0: { id: 0, name: 'Host' } },
    createdAt: 1,
    updatedAt: 10,
    ...partial,
  }
}

describe('SqliteStorage', () => {
  let dir = ''
  let db: SqliteStorage

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = ''
  })

  function open() {
    dir = mkdtempSync(join(tmpdir(), 'thulla-sqlite-'))
    db = new SqliteStorage(join(dir, 'test.sqlite'))
    db.connect()
    return db
  }

  it('persists create / setState / metadata across reconnect', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'thulla-sqlite-')), 'game.sqlite')
    dir = path.slice(0, path.lastIndexOf('/'))

    const first = new SqliteStorage(path)
    first.connect()
    first.createMatch('m1', {
      initialState: fakeState(0),
      metadata: fakeMeta(),
    })
    first.setState('m1', fakeState(1), [{ _stateID: 0, action: { type: 'MAKE_MOVE' } } as never])
    first.setMetadata('m1', fakeMeta({ updatedAt: 99 }))

    const second = new SqliteStorage(path)
    second.connect()
    const fetched = second.fetch('m1', {
      state: true,
      metadata: true,
      initialState: true,
      log: true,
    })

    expect(fetched.state?._stateID).toBe(1)
    expect(fetched.initialState?._stateID).toBe(0)
    expect(fetched.metadata?.updatedAt).toBe(99)
    expect(fetched.log).toHaveLength(1)
    expect(second.listMatches({ gameName: 'thulla-express' })).toEqual(['m1'])
  })

  it('filters listMatches by gameover and wipes rows', () => {
    open()
    db.createMatch('live', { initialState: fakeState(0), metadata: fakeMeta() })
    db.createMatch('done', {
      initialState: fakeState(0),
      metadata: fakeMeta({ gameover: { bhabhi: '0' }, updatedAt: 50 }),
    })

    expect(db.listMatches({ where: { isGameover: true } })).toEqual(['done'])
    expect(db.listMatches({ where: { isGameover: false } })).toEqual(['live'])

    db.wipe('done')
    expect(db.listMatches()).toEqual(['live'])
  })

  it('upserts deal_results from G.dealHistory on setState', () => {
    open()
    db.createMatch('m1', {
      initialState: fakeState(0),
      metadata: fakeMeta({
        players: {
          0: { id: 0, name: 'Ali', credentials: 'c0' },
          1: { id: 1, name: 'Bea', credentials: 'c1' },
        },
      }),
    })

    db.setState('m1', {
      ...fakeState(1),
      G: {
        dealHistory: [{ deal: 1, bhabhi: '0', gotAway: ['1'], at: 50 }],
      },
    })
    db.setState('m1', {
      ...fakeState(2),
      G: {
        dealHistory: [
          { deal: 1, bhabhi: '0', gotAway: ['1'], at: 50 },
          { deal: 2, bhabhi: '1', gotAway: ['0'], at: 80 },
        ],
      },
    })

    const board = db.getAppStore().getLeaderboard('m1')
    expect(board.deals).toHaveLength(2)
    expect(board.players.find((row) => row.playerID === '0')).toMatchObject({
      name: 'Ali',
      bhabhi: 1,
      gotAway: 1,
    })
    expect(board.players.find((row) => row.playerID === '1')).toMatchObject({
      name: 'Bea',
      bhabhi: 1,
      gotAway: 1,
    })
  })
})
