import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { AppError } from './appStore'
import { applyAppSchema } from './appSchema'
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

  it('soft-deletes a chat row and hides it from the table', () => {
    const app = open()
    app.appendChat({ id: 'c1', matchID: 'm1', senderSeat: '0', text: 'hello', at: 10 })
    app.appendChat({ id: 'c2', matchID: 'm1', senderSeat: '1', text: 'hi', at: 20 })

    app.softDeleteChat('m1', 'c1', '0')

    expect(app.listChat('m1').map((row) => row.text)).toEqual(['hi'])
    expect(app.chatRow('c1')).toMatchObject({ text: 'hello', deletedAt: expect.any(Number) })
    expect(() => app.softDeleteChat('m1', 'c2', '0')).toThrow(AppError)
    expect(() => app.softDeleteChat('m1', 'c2', '0')).toThrow(/own message/i)
    expect(app.chatRow('c2')?.deletedAt).toBeNull()
  })

  it('shows a late seat only the chat sent after they sat', () => {
    const app = open()
    app.appendChat({ id: 'early', matchID: 'm1', senderSeat: '0', text: 'before you sat', at: 10 })
    app.noteSeat('m1', '1', null, 30)
    app.appendChat({ id: 'late', matchID: 'm1', senderSeat: '0', text: 'welcome', at: 40 })

    expect(app.chatView('m1', '1')).toMatchObject({
      open: true,
      messages: [expect.objectContaining({ text: 'welcome' })],
    })
    expect(app.chatView('m1', '0').messages.map((row) => row.text)).toEqual([
      'before you sat',
      'welcome',
    ])
  })

  it('closes chat when a deal finishes and hides it again after play again', () => {
    dir = mkdtempSync(join(tmpdir(), 'thulla-app-'))
    const storage = new SqliteStorage(join(dir, 'test.sqlite'))
    storage.connect()
    storage.createMatch('m1', { initialState: fakeState(), metadata: fakeMeta() })
    const app = storage.getAppStore()

    app.appendChat({ id: 'old', matchID: 'm1', senderSeat: '0', text: 'old deal', at: 10 })
    storage.setState('m1', fakeState({ phase: 'finished', started: true, hostID: '0', left: [] }))

    expect(app.chatView('m1', '0')).toMatchObject({ messages: [], open: false })
    expect(() => app.appendChat({ matchID: 'm1', senderSeat: '0', text: 'too late' })).toThrow(
      /closed/i,
    )

    storage.setState('m1', fakeState({ phase: 'preTrick', started: true, hostID: '0', left: [] }))
    const view = app.chatView('m1', '0')
    expect(view.open).toBe(true)
    expect(view.messages).toEqual([])
    expect(view.visibleAfter).toBeGreaterThan(10)
    expect(app.chatRow('old')).toMatchObject({ text: 'old deal', deletedAt: null })
  })

  it('lets a signed-in player reclaim their seat, and blocks everyone after close', () => {
    dir = mkdtempSync(join(tmpdir(), 'thulla-app-'))
    const storage = new SqliteStorage(join(dir, 'test.sqlite'))
    storage.connect()
    storage.createMatch('m1', {
      initialState: fakeState({ phase: 'preTrick', started: true, hostID: '0', left: [] }),
      metadata: fakeMeta(),
    })
    const app = storage.getAppStore()
    const owner = app.signup('bea@example.com', 'secret123', 'Bea')
    const stranger = app.signup('cam@example.com', 'secret123', 'Cam')
    app.noteSeat('m1', '1', null, 5)
    app.noteSeat('m1', '1', owner.user.id, 999)

    expect(app.joinBlock('m1')).toBe('started')
    expect(app.reclaimSeat('m1', owner.user.id)).toEqual({
      playerID: '1',
      credentials: 'cred-1',
      playerName: 'Bea',
    })
    expect(app.chatView('m1', '1').visibleAfter).toBe(5)
    expect(() => app.reclaimSeat('m1', stranger.user.id)).toThrow(/not seated/i)

    storage.setState('m1', fakeState({ phase: 'finished', started: true, hostID: '0', left: ['2'] }))
    expect(app.departResult('m1', '0')).toEqual({ closed: false })
    expect(app.departResult('m1', '1')).toEqual({ closed: true })
    expect(storage.fetch('m1', { state: true }).state).toBeUndefined()
    expect(app.joinBlock('m1')).toBe('closed')
    expect(() => app.chatView('m1', '1')).toThrow(/ended/i)
    expect(() => app.reclaimSeat('m1', owner.user.id)).toThrow(/ended/i)
    expect(() => app.closeMatch('m1', '1')).not.toThrow()
  })

  it('lets only the host end a finished table', () => {
    dir = mkdtempSync(join(tmpdir(), 'thulla-app-'))
    const storage = new SqliteStorage(join(dir, 'test.sqlite'))
    storage.connect()
    storage.createMatch('m1', {
      initialState: fakeState({ phase: 'finished', started: true, hostID: '0', left: [] }),
      metadata: fakeMeta(),
    })
    const app = storage.getAppStore()
    expect(() => app.closeMatch('m1', '1')).toThrow(/host/i)
    app.closeMatch('m1', '0')
    expect(app.isClosed('m1')).toBe(true)
    expect(app.matchGate('m1')).toEqual({ closed: true, started: true })
  })

  it('shows a spectator the public table only', () => {
    dir = mkdtempSync(join(tmpdir(), 'thulla-app-'))
    const storage = new SqliteStorage(join(dir, 'test.sqlite'))
    storage.connect()
    storage.createMatch('m1', {
      initialState: fakeState({
        started: true,
        phase: 'preTrick',
        hostID: '0',
        hands: {
          '0': [{ id: 'AS', suit: 'S', rank: 14 }],
          '1': [{ id: 'KH', suit: 'H', rank: 13 }],
        },
        waste: [{ id: '2C', suit: 'C', rank: 2 }],
        peekers: { '0': true },
        handCounts: { '0': 1, '1': 1 },
        trick: [{ playerID: '0', card: { id: 'QS', suit: 'S', rank: 12 } }],
      }),
      metadata: fakeMeta(),
    })
    const app = storage.getAppStore()
    const view = app.watchSnapshot('m1')

    expect(view.closed).toBe(false)
    expect(view.G.hands['0']).toEqual([])
    expect(view.G.hands['1']).toEqual([])
    expect(view.G.waste).toEqual([])
    expect(view.G.peekers).toBeUndefined()
    expect(view.G.handCounts).toEqual({ '0': 1, '1': 1 })
    expect(view.G.trick).toHaveLength(1)
    expect(view.seats.map((seat) => seat.name)).toEqual(['Ali', 'Bea', 'Cam'])
    expect(JSON.stringify(view)).not.toContain('cred-0')
    expect(view).not.toHaveProperty('log')

    storage.setState('m1', fakeState({ phase: 'finished', started: true, hostID: '0', left: [] }))
    app.closeMatch('m1', '0')
    expect(app.joinBlock('m1')).toBe('closed')
    expect(() => app.watchSnapshot('m1')).toThrow(/ended/i)
  })

  it('adds deleted_at when an older chat table has no such column', () => {
    dir = mkdtempSync(join(tmpdir(), 'thulla-app-'))
    const db = new Database(join(dir, 'old.sqlite'))
    db.exec(`
      CREATE TABLE chat_messages (
        id TEXT PRIMARY KEY,
        match_id TEXT NOT NULL,
        sender_seat TEXT NOT NULL,
        user_id INTEGER,
        text TEXT NOT NULL,
        at INTEGER NOT NULL
      );
    `)
    applyAppSchema(db)
    const columns = db.prepare(`PRAGMA table_info(chat_messages)`).all() as Array<{ name: string }>
    expect(columns.map((column) => column.name)).toContain('deleted_at')
    db.close()
  })
})
