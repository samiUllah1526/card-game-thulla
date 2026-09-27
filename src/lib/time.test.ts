import { describe, expect, it } from 'vitest'
import { formatLocalDateTime, formatLocalTime, toUtcIso, utcNowMs } from './time'

describe('time helpers', () => {
  const utc = Date.UTC(2026, 8, 26, 7, 45, 0)

  it('utcNowMs is a finite epoch millisecond', () => {
    const now = utcNowMs()
    expect(Number.isFinite(now)).toBe(true)
    expect(now).toBeGreaterThan(1_700_000_000_000)
  })

  it('toUtcIso ends with Z', () => {
    expect(toUtcIso(utc)).toBe('2026-09-26T07:45:00.000Z')
  })

  it('formatLocalTime and formatLocalDateTime return non-empty locale strings', () => {
    expect(formatLocalTime(utc).length).toBeGreaterThan(0)
    expect(formatLocalDateTime(utc).length).toBeGreaterThan(0)
    expect(formatLocalDateTime(utc)).toMatch(/2026/)
  })
})
