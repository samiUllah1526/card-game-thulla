import type { BotPolicy } from '../types'
import { playCards, preferImmediate, withoutTake } from './common'

/**
 * Plays a random legal card with a slight bias toward card plays over
 * meta-actions (take / dismiss). Still makes plenty of mistakes — the
 * point is to be beatable by anyone who knows the rules.
 */
export const rookie: BotPolicy = {
  id: 'rookie',
  choose(_view, _playerID, actions, rng) {
    const immediate = preferImmediate(actions)
    if (immediate) return immediate

    const plays = playCards(actions)
    if (plays.length > 0 && rng() < 0.8) {
      return plays[Math.floor(rng() * plays.length)]
    }
    const pool = withoutTake(actions)
    return pool[Math.floor(rng() * pool.length)]
  },
}
