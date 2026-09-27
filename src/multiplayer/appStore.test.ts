import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AppError } from './appStore'
import { SqliteStorage } from './sqliteStorage'
import type { Server, State } from 'boardgame.io'

function fakeState(partialG: Record<string, unknown> = {}): State {
  return {
    G: partialG,
    ctx: { numPlayers: 3, currentPlayer: '0', playOrder: ['0', '1', '2'] } as State['ctx'],
    plugins: {},
    _undo: [],
    _redo: [],
    _stateID: 1,
  }
}

function fakeMeta(partial: Partial<Server.MatchData> = {}): Server.MatchData {
  return {
    gameName: 'thulla-express',
    players: {
      0: { id: 0, name: 'Ali', credentials: 'cred-0' },
      1: { id: 1, name: 'Bea', credentials: 'cred-1' },
      2: { id: 2, name: 'Cam', credentials: 'cred-2' },
    },
    createdAt: 1,
    updatedAt: 10,
    ...partial,
  }
}

describe('AppStore auth, chat, and deals', () => {
  let dir = ''

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = ''
  })

  function open() {
    dir = mkdtempSync(join(tmpdir(), 'thulla-app-'))
    const storage = new SqliteStorage(join(dir, 'test.sqlite'))
    storage.connect()
    storage.createMatch('m1', { initialState: fakeState(), metadata: fakeMeta() })
    storage.createMatch('m2', { initialState: fakeState(), metadata: fakeMeta() })
    return storage.getAppStore()
  }

  it('signs up, logs in, and rejects duplicates / bad passwords', () => {
    const app = open()
    const created = app.signup('Ali@example.com', 'secret123', 'Ali')
    expect(created.user).toMatchObject({ email: 'ali@example.com', displayName: 'Ali' })
    expect(app.userForToken(created.token)?.displayName).toBe('Ali')

    expect(() => app.signup('ali@example.com', 'secret123', 'Other')).toThrow(AppError)

    const loggedIn = app.login('ALI@example.com', 'secret123')
    expect(loggedIn.user.id).toBe(created.user.id)

    expect(() => app.login('ali@example.com', 'nope-nope')).toThrow(/wrong/i)
    expect(() => app.signup('not-an-email', 'secret123', 'Ali')).toThrow(/email/i)
    expect(() => app.signup('ok@example.com', 'short', 'Ali')).toThrow(/password/i)
  })

  it('logout drops the session token', () => {
    const app = open()
    const { token } = app.signup('bea@example.com', 'secret123', 'Bea')
    expect(app.userForToken(token)).not.toBeNull()
    app.deleteSession(token)
    expect(app.userForToken(token)).toBeNull()
  })

  it('stores chat per match and ignores other tables', () => {
    const app = open()
    app.requireSeat('m1', '0', 'cred-0')
    app.appendChat({ id: 'c1', matchID: 'm1', senderSeat: '0', text: 'hello', at: 10 })
    app.appendChat({ id: 'c2', matchID: 'm1', senderSeat: '1', text: 'hi', at: 20 })
    app.appendChat({ id: 'c3', matchID: 'm2', senderSeat: '0', text: 'other table', at: 15 })

    expect(app.listChat('m1').map((row) => row.text)).toEqual(['hello', 'hi'])
    expect(app.listChat('m2').map((row) => row.text)).toEqual(['other table'])
    expect(() => app.requireSeat('m1', '0', 'nope')).toThrow(/not seated/i)
  })
})
