import type { DealResult, LobbySeat } from '../games/bhabhi-thulla/types'

export interface LeaderboardPlayer {
  playerID: string
  name: string
  gotAway: number
  bhabhi: number
}

export interface MatchLeaderboard {
  deals: DealResult[]
  players: LeaderboardPlayer[]
}

export function tallyLeaderboard(
  deals: DealResult[],
  seats: LobbySeat[] = [],
): MatchLeaderboard {
  const names = new Map(seats.map((seat) => [String(seat.id), seat.name ?? `Player ${seat.id + 1}`]))
  const gotAway = new Map<string, number>()
  const bhabhi = new Map<string, number>()

  for (const deal of deals) {
    bhabhi.set(deal.bhabhi, (bhabhi.get(deal.bhabhi) ?? 0) + 1)
    for (const id of deal.gotAway) {
      gotAway.set(id, (gotAway.get(id) ?? 0) + 1)
    }
  }

  const ids = new Set<string>([
    ...seats.map((seat) => String(seat.id)),
    ...bhabhi.keys(),
    ...gotAway.keys(),
  ])

  const players = [...ids]
    .sort((a, b) => Number(a) - Number(b))
    .map((playerID) => ({
      playerID,
      name: names.get(playerID) ?? `Player ${Number(playerID) + 1}`,
      gotAway: gotAway.get(playerID) ?? 0,
      bhabhi: bhabhi.get(playerID) ?? 0,
    }))

  return { deals: [...deals].sort((a, b) => a.deal - b.deal), players }
}
