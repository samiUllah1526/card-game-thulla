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
})
