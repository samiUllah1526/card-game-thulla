/**
 * What the join link may offer after the gate has loaded.
 * A reclaimed seat skips the choice and sits back down.
 */
export function linkOffer(input: {
  closed: boolean
  started: boolean
  missing: boolean
  hasEmptySeat: boolean
  reclaimed: boolean
}): { sit: boolean; watch: boolean; ended: boolean } {
  if (input.reclaimed) return { sit: false, watch: false, ended: false }
  if (input.closed) return { sit: false, watch: false, ended: true }
  if (input.missing) return { sit: false, watch: false, ended: false }
  if (input.started) return { sit: false, watch: true, ended: false }
  return { sit: input.hasEmptySeat, watch: true, ended: false }
}
