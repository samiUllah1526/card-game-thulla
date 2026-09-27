import { config } from '../config'

/** Seats to fill from the create-table control. `rest` is everyone except the host. */
export function seatsToFill(seatCount: number, choice: string): string[] {
  const open = Math.max(0, Math.floor(seatCount) - 1)
  if (choice === 'rest') {
    return Array.from({ length: open }, (_, index) => String(index + 1))
  }
  const count = Number(choice)
  if (!Number.isFinite(count) || count <= 0) return []
  const filled = Math.min(open, Math.floor(count))
  return Array.from({ length: filled }, (_, index) => String(index + 1))
}

/** Stable display name for a bot seat, skipping names already at the table. */
export function botDisplayName(playerID: string, taken: readonly string[]): string {
  const list = config.bots.names
  const index = Math.max(0, Number(playerID) - 1)
  const base = list[index % list.length] ?? `Bot ${Number(playerID) + 1}`
  const used = new Set(taken.map((name) => name.trim().toLowerCase()))
  if (!used.has(base.toLowerCase())) return base
  let suffix = 2
  while (used.has(`${base} ${suffix}`.toLowerCase())) suffix += 1
  return `${base} ${suffix}`
}
