// Temporary test driver. Plays the given seats; bot receivers dismiss pickups after a delay.
import { Client } from 'boardgame.io/client'
import { SocketIO } from 'boardgame.io/multiplayer'
import { BhabhiThulla } from './src/games/bhabhi-thulla/game'
import { legalCards } from './src/games/bhabhi-thulla/rules'
import type { BhabhiState } from './src/games/bhabhi-thulla/types'

const server = 'http://localhost:8000'
const matchID = process.argv[2]
const creds: Record<string, string> = JSON.parse(process.argv[3])
const stopAtPickup = Number(process.argv[4] ?? 1)
const DELAY = Number(process.argv[5] ?? 1500)
const DISMISS_DELAY = Number(process.argv[6] ?? 4000)
const humanSeat = process.argv[7] ?? '0'

let busy = false
let startSent = false
let dismissScheduled = 0

for (const pid of Object.keys(creds)) {
  const client = Client<BhabhiState>({
    game: BhabhiThulla,
    matchID,
    playerID: pid,
    credentials: creds[pid],
    multiplayer: SocketIO({ server }),
    debug: false,
  })

  client.subscribe((s) => {
    if (!s) return
    const G = s.G
    if (G.lastPickup && G.lastPickup.id >= stopAtPickup && G.lastPickup.dismissed) {
      console.log('DONE', JSON.stringify(G.lastPickup))
      setTimeout(() => process.exit(0), 200)
      return
    }
    if (G.lastPickup && !G.lastPickup.dismissed) {
      if (G.lastPickup.receiver === pid && pid !== humanSeat && dismissScheduled !== G.lastPickup.id) {
        dismissScheduled = G.lastPickup.id
        console.log(`P${pid} will dismiss pickup ${G.lastPickup.id} in ${DISMISS_DELAY}ms`)
        setTimeout(() => client.moves.dismissPickup(), DISMISS_DELAY)
      }
      return
    }
    if (!G.started) {
      if (pid === '0' && !startSent) {
        startSent = true
        setTimeout(() => client.moves.startGame(), 800)
      }
      return
    }
    if (G.phase === 'finished' || G.turnPlayer !== pid || busy) return
    busy = true
    setTimeout(() => {
      const hand = G.hands[pid]
      const legal = legalCards(hand, G.ledSuit)
      let card = legal[0]
      if (G.firstTrick && G.trick.length === 0) card = hand.find((c) => c.id === 'S-14') ?? card
      console.log(`P${pid} plays ${card.id} (led ${G.ledSuit ?? '-'})`)
      client.moves.playCard(card.id)
      busy = false
    }, DELAY)
  })
  client.start()
}
