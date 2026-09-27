import Router from '@koa/router'
import type { Context } from 'koa'
import bodyParser from 'koa-bodyparser'
import { config } from '../config'
import type { BotService } from '../bots/service'
import { sanitizeChatText } from './chat'
import { AppError, type AppStore } from './appStore'
import { googleClientId, verifyGoogleCredential } from './googleAuth'
import { subscribeWatch } from './watchHub'

const COOKIE = config.auth.cookieName
const cookieOpts = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: config.auth.sessionDays * 24 * 60 * 60 * 1000,
}

export function createAppRouter(store: AppStore | null, bots: BotService | null = null): Router {
  const router = new Router()
  router.use(bodyParser())

  const needStore = (ctx: Context): AppStore | null => {
    if (store) return store
    ctx.status = 503
    ctx.body = { error: 'Accounts are only available with the sqlite match store.' }
    return null
  }

  const needBots = (ctx: Context): BotService | null => {
    if (bots) return bots
    ctx.status = 503
    ctx.body = { error: 'Bots are only available with the sqlite match store.' }
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

  router.get('/auth/providers', (ctx) => {
    ctx.body = { googleClientId: googleClientId() }
  })

  router.post('/auth/google', async (ctx) => {
    const db = needStore(ctx)
    if (!db) return
    try {
      const body = jsonBody(ctx)
      const profile = await verifyGoogleCredential(str(body.credential))
      const result = db.loginWithGoogle(profile)
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
      const seat = requireSeat(ctx, db, matchID)
      ctx.body = db.chatView(matchID, seat.playerID)
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

  router.delete('/api/matches/:id/chat/:messageId', (ctx) => {
    const db = needStore(ctx)
    if (!db) return
    try {
      const matchID = String(ctx.params.id)
      const seat = requireSeat(ctx, db, matchID)
      db.softDeleteChat(matchID, String(ctx.params.messageId), seat.playerID)
      ctx.body = { ok: true }
    } catch (reason) {
      sendError(ctx, reason)
    }
  })

  router.post('/api/matches/:id/seat', (ctx) => {
    const db = needStore(ctx)
    if (!db) return
    try {
      const matchID = String(ctx.params.id)
      if (db.isClosed(matchID)) throw new AppError('This table has ended.', 410)
      const seat = requireSeat(ctx, db, matchID)
      const user = db.userForToken(ctx.cookies.get(COOKIE))
      db.noteSeat(matchID, seat.playerID, user?.id)
      ctx.body = { ok: true }
    } catch (reason) {
      sendError(ctx, reason)
    }
  })

  router.get('/api/matches/:id/watch', (ctx) => {
    const db = needStore(ctx)
    if (!db) return
    try {
      ctx.body = db.watchSnapshot(String(ctx.params.id))
    } catch (reason) {
      sendError(ctx, reason)
    }
  })

  router.get('/api/matches/:id/watch/events', (ctx) => {
    const db = needStore(ctx)
    if (!db) return
    const matchID = String(ctx.params.id)
    ctx.request.socket.setTimeout(0)
    ctx.respond = false
    ctx.res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })

    let ended = false
    let ping: ReturnType<typeof setInterval> | undefined
    let unsubscribe = () => {}
    const send = (payload: unknown) => {
      if (ended) return
      ctx.res.write(`data: ${JSON.stringify(payload)}\n\n`)
    }
    const finish = () => {
      if (ended) return
      ended = true
      if (ping) clearInterval(ping)
      unsubscribe()
      ctx.res.end()
    }

    try {
      send(db.watchSnapshot(matchID))
    } catch (reason) {
      if (reason instanceof AppError && reason.status === 410) send({ closed: true })
      finish()
      return
    }

    unsubscribe = subscribeWatch(matchID, (event) => {
      send(event)
      if ('closed' in event && event.closed === true && !('G' in event)) finish()
    })
    ping = setInterval(() => {
      if (!ended) ctx.res.write(': ping\n\n')
    }, 15000)
    ctx.req.on('close', finish)
  })

  router.get('/api/matches/:id/gate', (ctx) => {
    const db = needStore(ctx)
    if (!db) return
    ctx.body = db.matchGate(String(ctx.params.id))
  })

  router.post('/api/matches/:id/reclaim', (ctx) => {
    const db = needStore(ctx)
    if (!db) return
    try {
      const user = db.userForToken(ctx.cookies.get(COOKIE))
      if (!user) throw new AppError('Sign in to rejoin this seat.', 401)
      const seat = db.reclaimSeat(String(ctx.params.id), user.id)
      ctx.body = { matchID: String(ctx.params.id), ...seat }
    } catch (reason) {
      sendError(ctx, reason)
    }
  })

  router.post('/api/matches/:id/close', (ctx) => {
    const db = needStore(ctx)
    if (!db) return
    try {
      const matchID = String(ctx.params.id)
      const seat = requireSeat(ctx, db, matchID)
      db.closeMatch(matchID, seat.playerID)
      ctx.body = { ok: true }
    } catch (reason) {
      sendError(ctx, reason)
    }
  })

  router.post('/api/matches/:id/depart', (ctx) => {
    const db = needStore(ctx)
    if (!db) return
    try {
      const matchID = String(ctx.params.id)
      const seat = requireSeat(ctx, db, matchID)
      ctx.body = db.departResult(matchID, seat.playerID)
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

  router.post('/api/matches/:id/bots/fill', async (ctx) => {
    const db = needStore(ctx)
    const service = needBots(ctx)
    if (!db || !service) return
    try {
      const matchID = String(ctx.params.id)
      const seat = requireSeat(ctx, db, matchID)
      const body = jsonBody(ctx)
      const seats = Array.isArray(body.seats) ? body.seats.map((id) => String(id)) : []
      ctx.body = await service.fill({
        matchID,
        actorID: seat.playerID,
        seats,
        difficulty: str(body.difficulty),
      })
    } catch (reason) {
      sendError(ctx, reason)
    }
  })

  router.put('/api/matches/:id/bots/:seat', async (ctx) => {
    const db = needStore(ctx)
    const service = needBots(ctx)
    if (!db || !service) return
    try {
      const matchID = String(ctx.params.id)
      const seat = requireSeat(ctx, db, matchID)
      const body = jsonBody(ctx)
      ctx.body = await service.seat({
        matchID,
        actorID: seat.playerID,
        seat: String(ctx.params.seat),
        difficulty: str(body.difficulty),
      })
    } catch (reason) {
      sendError(ctx, reason)
    }
  })

  router.delete('/api/matches/:id/bots/:seat', async (ctx) => {
    const db = needStore(ctx)
    const service = needBots(ctx)
    if (!db || !service) return
    try {
      const matchID = String(ctx.params.id)
      const seat = requireSeat(ctx, db, matchID)
      await service.clear({
        matchID,
        actorID: seat.playerID,
        seat: String(ctx.params.seat),
      })
      ctx.body = { ok: true }
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
