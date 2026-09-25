import { config } from '../config'
import type { LobbySeat, Session, SetupData } from '../games/bhabhi-thulla/types'

const GAME = config.game.name
const SESSION_KEY = config.storage.sessionKey

interface MatchResponse {
  matchID: string
  players: Array<{ id: number; name?: string }>
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  const body = await response.json()
  if (!response.ok) throw new Error(body.error ?? 'Could not reach the game server')
  return body as T
}

export async function createMatch(
  playerName: string,
  numPlayers: number,
  setupData: SetupData = {},
): Promise<Session> {
  const created = await json<{ matchID: string }>(`/games/${GAME}/create`, {
    method: 'POST',
    body: JSON.stringify({
      numPlayers,
      setupData: {
        shuffleAlgorithm: setupData.shuffleAlgorithm ?? config.shuffle.defaultAlgorithm,
        shuffleScale: setupData.shuffleScale ?? config.shuffle.defaultScale,
      },
    }),
  })
  return joinMatch(created.matchID, '0', playerName)
}

export async function joinMatch(
  matchID: string,
  playerID: string,
  playerName: string,
): Promise<Session> {
  const joined = await json<{ playerCredentials: string }>(
    `/games/${GAME}/${matchID}/join`,
    {
      method: 'POST',
      body: JSON.stringify({ playerID: Number(playerID), playerName }),
    },
  )
  return {
    matchID,
    playerID,
    playerName,
    credentials: joined.playerCredentials,
  }
}

export async function getSeats(matchID: string): Promise<LobbySeat[]> {
  const match = await json<MatchResponse>(`/games/${GAME}/${matchID}`)
  return match.players.map(({ id, name }) => ({ id, name }))
}

export function saveSession(session: Session): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

export function loadSession(): Session | null {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null')
  } catch {
    return null
  }
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY)
}
