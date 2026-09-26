import Router from '@koa/router'
import type { Context } from 'koa'
import { config } from '../config'
import { sanitizeChatText } from './chat'
import { AppError, type AppStore } from './appStore'

const COOKIE = config.auth.cookieName
const cookieOpts = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: config.auth.sessionDays * 24 * 60 * 60 * 1000,
}

export function createAppRouter(store: AppStore | null): Router {
  const router = new Router()

  const needStore = (ctx: Context): AppStore | null => {
    if (store) return store
    ctx.status = 503
    ctx.body = { error: 'Accounts are only available with the sqlite match store.' }
    return null
  }

  router.post('/auth/signup', (ctx) => {
    const db = needStore(ctx)
    if (!db) return
    try {
      const body = jsonBody(ctx)
      const result = db.signup(str(body.email), str(body.password), str(body.displayName))
      ctx.cookies.set(COOKIE, result.token, cookieOpts)
      ctx.body = { user: result.user }
    } catch (reason) {
      sendError(ctx, reason)
    }
  })

  router.post('/auth/login', (ctx) => {
    const db = needStore(ctx)
    if (!db) return
    try {
      const body = jsonBody(ctx)
      const result = db.login(str(body.email), str(body.password))
      ctx.cookies.set(COOKIE, result.token, cookieOpts)
      ctx.body = { user: result.user }
    } catch (reason) {
      sendError(ctx, reason)
    }
  })

  router.post('/auth/logout', (ctx) => {
    const db = needStore(ctx)
    if (!db) return
    const token = ctx.cookies.get(COOKIE)
    if (token) db.deleteSession(token)
    ctx.cookies.set(COOKIE, '', { ...cookieOpts, maxAge: 0 })
    ctx.body = { ok: true }
  })

  router.get('/auth/me', (ctx) => {
    const db = needStore(ctx)
    if (!db) return
    const user = db.userForToken(ctx.cookies.get(COOKIE))
    ctx.body = { user }
  })

  router.get('/api/matches/:id/chat', (ctx) => {
    const db = needStore(ctx)
    if (!db) return
    try {
      const matchID = String(ctx.params.id)
      requireSeat(ctx, db, matchID)
      ctx.body = { messages: db.listChat(matchID) }
    } catch (reason) {
      sendError(ctx, reason)
    }
  })

  router.post('/api/matches/:id/chat', (ctx) => {
    const db = needStore(ctx)
    if (!db) return
    try {
      const matchID = String(ctx.params.id)
      const seat = requireSeat(ctx, db, matchID)
      const body = jsonBody(ctx)
      const text = sanitizeChatText(str(body.text))
      if (!text) throw new AppError('Message is empty.', 400)
      const user = db.userForToken(ctx.cookies.get(COOKIE))
      const message = db.appendChat({
        id: typeof body.id === 'string' ? body.id : undefined,
        matchID,
        senderSeat: seat.playerID,
        userID: user?.id,
        text,
        at: typeof body.at === 'number' ? body.at : undefined,
      })
      ctx.body = { message }
    } catch (reason) {
      sendError(ctx, reason)
    }
  })

  router.get('/api/matches/:id/leaderboard', (ctx) => {
    const db = needStore(ctx)
    if (!db) return
    try {
      const matchID = String(ctx.params.id)
      requireSeat(ctx, db, matchID)
      ctx.body = db.getLeaderboard(matchID)
    } catch (reason) {
      sendError(ctx, reason)
    }
  })

  return router
}

function jsonBody(ctx: Context): Record<string, unknown> {
  const body = ctx.request.body
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    return body as Record<string, unknown>
  }
  return {}
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function requireSeat(ctx: Context, store: AppStore, matchID: string): { playerID: string } {
  const playerID = String(
    ctx.get('x-player-id') || jsonBody(ctx).playerID || '',
  )
  const credentials = String(
    ctx.get('x-credentials') || jsonBody(ctx).credentials || '',
  )
  if (!playerID || !credentials) throw new AppError('Missing table credentials.', 401)
  store.requireSeat(matchID, playerID, credentials)
  return { playerID }
}

function sendError(ctx: Context, reason: unknown): void {
  if (reason instanceof AppError) {
    ctx.status = reason.status
    ctx.body = { error: reason.message }
    return
  }
  ctx.status = 500
  ctx.body = { error: 'Something went wrong.' }
}
