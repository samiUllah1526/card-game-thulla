import type { PublicUser } from './authTypes'
import type { TableChatMessage } from './chat'
import type { MatchLeaderboard } from './leaderboard'
import type { Session } from '../games/bhabhi-thulla/types'

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  const body = (await response.json().catch(() => ({}))) as { error?: string } & T
  if (!response.ok) throw new Error(body.error ?? 'Could not reach the game server')
  return body
}

function seatHeaders(session: Session): Record<string, string> {
  return {
    'X-Player-ID': session.playerID,
    'X-Credentials': session.credentials,
  }
}

export async function fetchMe(): Promise<PublicUser | null> {
  const body = await json<{ user: PublicUser | null }>('/auth/me')
  return body.user
}

export async function signup(
  email: string,
  password: string,
  displayName: string,
): Promise<PublicUser> {
  const body = await json<{ user: PublicUser }>('/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password, displayName }),
  })
  return body.user
}

export async function login(email: string, password: string): Promise<PublicUser> {
  const body = await json<{ user: PublicUser }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  return body.user
}

export async function logout(): Promise<void> {
  await json('/auth/logout', { method: 'POST' })
}

export async function fetchMatchChat(session: Session): Promise<TableChatMessage[]> {
  const body = await json<{ messages: TableChatMessage[] }>(
    `/api/matches/${encodeURIComponent(session.matchID)}/chat`,
    { headers: seatHeaders(session) },
  )
  return body.messages ?? []
}

export async function persistMatchChat(
  session: Session,
  message: Pick<TableChatMessage, 'id' | 'text' | 'at'>,
): Promise<TableChatMessage> {
  const body = await json<{ message: TableChatMessage }>(
    `/api/matches/${encodeURIComponent(session.matchID)}/chat`,
    {
      method: 'POST',
      headers: seatHeaders(session),
      body: JSON.stringify(message),
    },
  )
  return body.message
}

export async function fetchMatchLeaderboard(session: Session): Promise<MatchLeaderboard> {
  return json<MatchLeaderboard>(
    `/api/matches/${encodeURIComponent(session.matchID)}/leaderboard`,
    { headers: seatHeaders(session) },
  )
}
