/** Shared peek debug logs (browser console + server terminal). */
const PREFIX = '[peek]'

export function peekLog(message: string, detail?: Record<string, unknown>): void {
  if (detail && Object.keys(detail).length > 0) {
    console.info(PREFIX, message, detail)
  } else {
    console.info(PREFIX, message)
  }
}
