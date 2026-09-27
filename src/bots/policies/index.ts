import type { BotDifficulty } from '../difficulty'
import type { BotPolicy } from '../types'
import { mastermind } from './mastermind'
import { rookie } from './rookie'
import { shark } from './shark'

const policies: BotPolicy[] = [rookie, shark, mastermind]

export function policyFor(id: BotDifficulty): BotPolicy {
  const policy = policies.find((item) => item.id === id)
  if (!policy) throw new Error(`No bot policy for ${id}`)
  return policy
}
