/**
 * Drive a 3-seat Ask-permission match.
 *
 *   npx tsx .tmp-bot.ts              # headless, fast
 *   npx tsx .tmp-bot.ts --watch      # slow; prints sessions; waits 8s so you can open UI
 *
 * Watch helper: after MATCH/SESSIONS print, open http://localhost:5173 in tabs
 * with each session in localStorage key `bhabhi-session`.
 */
import { Client } from 'boardgame.io/client'
import { SocketIO } from 'boardgame.io/multiplayer'
import { BhabhiThulla } from './src/games/bhabhi-thulla/game'
import { legalCards } from './src/games/bhabhi-thulla/rules'
import type { BhabhiState, Session } from './src/games/bhabhi-thulla/types'
import { writeFileSync } from 'node:fs'

const server = process.env.BOT_SERVER ?? 'http://localhost:8000'
const GAME = 'bhabhi-thulla'
const watch = process.argv.includes('--watch')
const DELAY = Number(process.env.BOT_DELAY ?? (watch ? 2200 : 500))
const WATCH_WAIT_MS = Number(process.env.BOT_WATCH_WAIT_MS ?? 10000)

type Phase =
  | 'boot'
  | 'waitStart'
  | 'ask1'
  | 'waitReject'
  | 'waitDismiss'
  | 'ask2'
  | 'waitAccept'
  | 'done'

let phase: Phase = 'boot'
let startSent = false
const busySeat = new Set<string>()
let scheduledAsk1 = false
let scheduledAsk2 = false
let scheduledReject = false
let scheduledDismiss = false
let scheduledAccept = false
let seenAskId = 0
let seenRejectId = 0

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${server}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  const body = await response.json()
  if (!response.ok) throw new Error(body.error ?? JSON.stringify(body))
  return body as T
}

async function setupMatch() {
  const created = await json<{ matchID: string }>(`/games/${GAME}/create`, {
    method: 'POST',
    body: JSON.stringify({
      numPlayers: 3,
      setupData: {
        shuffleAlgorithm: 'blendRandom',
        shuffleScale: 10,
        takeRequiresPermission: true,
      },
    }),
  })

  const sessions: Session[] = []
  const creds: Record<string, string> = {}
  for (const seat of ['0', '1', '2']) {
    const joined = await json<{ playerCredentials: string }>(
      `/games/${GAME}/${created.matchID}/join`,
      {
        method: 'POST',
        body: JSON.stringify({ playerID: seat, playerName: `Bot${seat}` }),
      },
    )
    creds[seat] = joined.playerCredentials
    sessions.push({
      matchID: created.matchID,
      playerID: seat,
      playerName: `Bot${seat}`,
      credentials: joined.playerCredentials,
    })
  }

  writeFileSync('.tmp-bot-sessions.json', JSON.stringify(sessions, null, 2))
  console.log('MATCH', created.matchID)
  console.log('MODE takeRequiresPermission=true')
  console.log('DELAY', DELAY, watch ? '(watch)' : '')
  console.log('SESSIONS_FILE .tmp-bot-sessions.json')
  for (const session of sessions) {
    console.log('SESSION', JSON.stringify(session))
  }
  return { matchID: created.matchID, creds, sessions }
}

function log(msg: string) {
  console.log(`[${phase}] ${msg}`)
}

function finish(ok: boolean, detail: string) {
  phase = 'done'
  console.log(ok ? 'PASS' : 'FAIL', detail)
  setTimeout(() => process.exit(ok ? 0 : 1), 400)
}

function runLater(pid: string, label: string, fn: () => void): boolean {
  if (busySeat.has(pid)) return false
  busySeat.add(pid)
  setTimeout(() => {
    busySeat.delete(pid)
    log(label)
    fn()
  }, DELAY)
  return true
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  const { matchID, creds } = await setupMatch()

  if (watch) {
    console.log('')
    console.log('Watch: open http://localhost:5173 — loading Bot seats in browser…')
    console.log(`Bots start in ${WATCH_WAIT_MS / 1000}s so the UI can connect.`)
    console.log('')
    await sleep(WATCH_WAIT_MS)
  }

  phase = 'waitStart'

  for (const pid of Object.keys(creds)) {
    const client = Client<BhabhiState>({
      game: BhabhiThulla,
      matchID,
      playerID: pid,
      credentials: creds[pid],
      multiplayer: SocketIO({ server }),
      debug: false,
    })

    client.subscribe((state) => {
      if (!state || phase === 'done') return
      const G = state.G as BhabhiState

      if (G.lastPickup && !G.lastPickup.dismissed && G.lastPickup.receiver === pid) {
        runLater(pid, `P${pid} dismisses Thulla ${G.lastPickup.id}`, () => {
          client.moves.dismissPickup()
        })
        return
      }

      if (!G.started) {
        if (pid === '0' && !startSent) {
          startSent = true
          runLater(pid, 'host starts game', () => {
            client.moves.startGame()
            phase = 'ask1'
          })
        }
        return
      }

      if (!G.takeRequiresPermission) {
        finish(false, 'takeRequiresPermission is false on G')
        return
      }

      if (phase === 'ask1' && G.pendingTake) {
        phase = 'waitReject'
        seenAskId = G.pendingTake.id
        log(`ask1 pending from=${G.pendingTake.from} to=${G.pendingTake.to}`)
      }
      if (phase === 'waitReject' && G.lastTakeReject && !G.lastTakeReject.dismissed) {
        phase = 'waitDismiss'
        seenRejectId = G.lastTakeReject.id
        log(`rejected roast id=${seenRejectId} from=${G.lastTakeReject.from}`)
      }
      if (phase === 'waitDismiss' && G.lastTakeReject?.dismissed) {
        phase = 'ask2'
        scheduledAsk2 = false
        log('roast dismissed — ready for ask2')
      }
      if (phase === 'ask2' && G.pendingTake) {
        phase = 'waitAccept'
        seenAskId = G.pendingTake.id
        log(`ask2 pending from=${G.pendingTake.from} to=${G.pendingTake.to}`)
      }
      if (phase === 'waitAccept' && G.events.some((e) => e.type === 'takeAccepted')) {
        const accepted = [...G.events].reverse().find((e) => e.type === 'takeAccepted')
        finish(true, JSON.stringify({
          takeRequiresPermission: G.takeRequiresPermission,
          seenAskId,
          seenRejectId,
          accepted,
          gotAway: G.gotAway,
          active: G.active,
          handCounts: G.handCounts,
        }))
        return
      }

      const canLeadTake =
        pid === G.leader &&
        pid === G.turnPlayer &&
        G.phase === 'preTrick' &&
        !G.pendingTake &&
        !(G.lastTakeReject && !G.lastTakeReject.dismissed) &&
        !(G.lastPickup && !G.lastPickup.dismissed)

      if (phase === 'ask1' && canLeadTake && !scheduledAsk1) {
        if (runLater(pid, `P${pid} asks to take next hand`, () => client.moves.takeLeftHand())) {
          scheduledAsk1 = true
        }
        return
      }

      if (
        phase === 'waitReject' &&
        G.pendingTake &&
        G.pendingTake.to === pid &&
        !scheduledReject
      ) {
        const n = G.handCounts[pid]
        if (
          runLater(pid, `P${pid} REJECTS take (had ${n} cards)`, () => {
            client.moves.respondTake(false)
          })
        ) {
          scheduledReject = true
        }
        return
      }

      if (
        phase === 'waitDismiss' &&
        G.lastTakeReject &&
        !G.lastTakeReject.dismissed &&
        G.lastTakeReject.from === pid &&
        !scheduledDismiss
      ) {
        if (
          runLater(pid, `P${pid} dismisses DENIED roast`, () => {
            client.moves.dismissTakeReject()
          })
        ) {
          scheduledDismiss = true
        }
        return
      }

      if (phase === 'ask2' && canLeadTake && !scheduledAsk2) {
        if (runLater(pid, `P${pid} asks to take again`, () => client.moves.takeLeftHand())) {
          scheduledAsk2 = true
        }
        return
      }

      if (
        phase === 'waitAccept' &&
        G.pendingTake &&
        G.pendingTake.to === pid &&
        !scheduledAccept
      ) {
        if (runLater(pid, `P${pid} ACCEPTS take`, () => client.moves.respondTake(true))) {
          scheduledAccept = true
        }
        return
      }

      if (
        G.phase !== 'finished' &&
        G.turnPlayer === pid &&
        !G.pendingTake &&
        !(G.lastTakeReject && !G.lastTakeReject.dismissed) &&
        !(G.lastPickup && !G.lastPickup.dismissed) &&
        (phase === 'ask1' || phase === 'ask2') &&
        !canLeadTake
      ) {
        const hand = G.hands[pid]
        const legal = legalCards(hand, G.ledSuit)
        if (!legal.length) return
        let card = legal[0]
        if (G.firstTrick && G.trick.length === 0) {
          card = hand.find((c) => c.id === 'S-14') ?? card
        }
        runLater(pid, `P${pid} plays ${card.id}`, () => client.moves.playCard(card.id))
      }
    })

    client.start()
  }

  setTimeout(() => {
    if (phase !== 'done') finish(false, `timeout stuck in phase=${phase}`)
  }, watch ? 120000 : 45000)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
