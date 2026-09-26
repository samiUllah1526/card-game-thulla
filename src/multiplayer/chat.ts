import { config } from '../config'

/** Normalized chat line shown in the UI. */
export interface TableChatMessage {
  id: string
  sender: string
  text: string
  at: number
}

export interface ChatPayload {
  text?: unknown
  at?: unknown
}

/** Trim and cap length; empty / whitespace-only → null. */
export function sanitizeChatText(
  raw: string,
  maxLength = config.chat.maxLength,
): string | null {
  const text = raw.replace(/\s+/g, ' ').trim()
  if (!text) return null
  return text.length > maxLength ? text.slice(0, maxLength) : text
}

/** Turn a boardgame.io chat entry (any payload shape) into our message, or null. */
export function normalizeChatMessage(entry: {
  id: string
  sender: string
  payload: unknown
}): TableChatMessage | null {
  let text: string | null = null
  let at = Date.now()

  if (typeof entry.payload === 'string') {
    text = sanitizeChatText(entry.payload)
  } else if (entry.payload && typeof entry.payload === 'object') {
    const payload = entry.payload as ChatPayload
    if (typeof payload.text === 'string') text = sanitizeChatText(payload.text)
    if (typeof payload.at === 'number' && Number.isFinite(payload.at)) at = payload.at
  }

  if (!text || !entry.id || entry.sender == null || entry.sender === '') return null
  return { id: entry.id, sender: String(entry.sender), text, at }
}

/** Merge by id, newest last, capped. */
export function mergeChatMessages(
  cached: TableChatMessage[],
  incoming: TableChatMessage[],
  historyCap: number = config.chat.historyCap,
): TableChatMessage[] {
  const byId = new Map<string, TableChatMessage>()
  for (const message of cached) byId.set(message.id, message)
  for (const message of incoming) byId.set(message.id, message)

  const merged = [...byId.values()].sort((a, b) => {
    if (a.at !== b.at) return a.at - b.at
    return a.id.localeCompare(b.id)
  })
  return merged.length > historyCap ? merged.slice(merged.length - historyCap) : merged
}

function storageKey(matchID: string): string {
  return `${config.chat.storageKey}:${matchID}`
}

/** Load ring buffer for this match (same phone / tab). */
export function loadChatCache(matchID: string): TableChatMessage[] {
  if (typeof sessionStorage === 'undefined') return []
  try {
    const raw = sessionStorage.getItem(storageKey(matchID))
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return mergeChatMessages(
      [],
      parsed
        .map((item) => {
          if (!item || typeof item !== 'object') return null
          const row = item as Partial<TableChatMessage>
          if (
            typeof row.id !== 'string' ||
            typeof row.sender !== 'string' ||
            typeof row.text !== 'string' ||
            typeof row.at !== 'number'
          ) {
            return null
          }
          const text = sanitizeChatText(row.text)
          if (!text) return null
          return { id: row.id, sender: row.sender, text, at: row.at }
        })
        .filter((item): item is TableChatMessage => !!item),
    )
  } catch {
    return []
  }
}

export function saveChatCache(matchID: string, messages: TableChatMessage[]): void {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.setItem(
      storageKey(matchID),
      JSON.stringify(messages.slice(-config.chat.historyCap)),
    )
  } catch {
    // Quota or private mode — chat still works in-memory.
  }
}
