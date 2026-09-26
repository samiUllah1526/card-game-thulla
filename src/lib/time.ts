/** UTC epoch milliseconds. Store this; format on the client. */
export function utcNowMs(): number {
  return Date.now()
}

/** ISO-8601 UTC string for <time datetime>. */
export function toUtcIso(ms: number): string {
  try {
    return new Date(ms).toISOString()
  } catch {
    return ''
  }
}

function zone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return undefined
  }
}

/** Hour:minute in the viewer's timezone. */
export function formatLocalTime(ms: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: zone(),
    }).format(new Date(ms))
  } catch {
    return ''
  }
}

/** Date + time in the viewer's timezone. */
export function formatLocalDateTime(ms: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: zone(),
    }).format(new Date(ms))
  } catch {
    return ''
  }
}
