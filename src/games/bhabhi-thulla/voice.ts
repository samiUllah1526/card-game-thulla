/** Spoken jokes for Thulla, a denied take, and the Bhabhi ending. */

const THULLA = [
  'Thulla! {giver} broke suit and dumped {count} cards on {receiver}. Pick those up, superstar.',
  'Uh oh. {giver} played off suit. {receiver}, those {count} cards are yours now. The table is thrilled.',
  'Thulla! {receiver} just inherited {count} cards from {giver}. Tragic. Hilarious.',
  'Wrong suit, {giver}! {receiver} has to scoop {count} cards. Everyone else is innocent. Allegedly.',
]

const BHABHI_OTHERS = [
  '{name} is Bhabhi! Hold the cards. Hold the shame. Take a bow.',
  'Game over. {name} is Bhabhi. Everyone else may point and laugh.',
  'The loser crown goes to {name}. Bhabhi. Heavy is the hand.',
  '{name} kept the cards and lost the deal. Unmatched Bhabhi energy.',
]

const BHABHI_YOU = [
  'You are Bhabhi. The table is laughing. You earned this.',
  'Congratulations. You lost. You are Bhabhi.',
  'All those clever plays, and you are still Bhabhi. Incredible.',
  'Bhabhi. That is you. Wave to your fans.',
]

const DENIED = [
  '{name} asked for the cards and got denied. The roast is free.',
  'Denied! {name} wanted those cards. The answer was a loud no.',
  '{name} tried to take the cards and got shut down. Bold. Failed. Funny.',
  'No cards for {name}. Request declined. Dignity also declined.',
]

const STORAGE_KEY = 'thulla-express-voice'

export function lineAt(lines: readonly string[], seed: number): string {
  if (lines.length === 0) return ''
  const index = ((seed % lines.length) + lines.length) % lines.length
  return lines[index]
}

export function fillVoice(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? '')
}

export function thullaLine(giver: string, receiver: string, count: number, seed: number): string {
  return fillVoice(lineAt(THULLA, seed), { giver, receiver, count: String(count) })
}

export function bhabhiLine(name: string, mine: boolean, seed: number): string {
  return fillVoice(lineAt(mine ? BHABHI_YOU : BHABHI_OTHERS, seed), { name })
}

/** Roast the player whose take was declined. */
export function denyLine(name: string, seed: number): string {
  return fillVoice(lineAt(DENIED, seed), { name })
}

export function voiceOn(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off'
  } catch {
    return true
  }
}

export function setVoiceOn(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off')
  } catch {
    // Private mode can block storage. The button still updates for this visit.
  }
}

export function silence(): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return
  window.speechSynthesis.cancel()
}

export function speak(text: string): void {
  if (!text || !voiceOn()) return
  if (typeof window === 'undefined' || !window.speechSynthesis) return
  const synth = window.speechSynthesis
  synth.cancel()
  const utter = new SpeechSynthesisUtterance(text)
  utter.lang = 'en-US'
  utter.rate = 1.04
  utter.pitch = 1.18
  const voice = playfulVoice(synth.getVoices())
  if (voice) utter.voice = voice
  synth.speak(utter)
}

function playfulVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  const english = voices.filter((voice) => voice.lang.toLowerCase().startsWith('en'))
  const pool = english.length ? english : voices
  return (
    pool.find((voice) => /uk english male|daniel|fred|rishi/i.test(voice.name)) ??
    pool.find((voice) => /google/i.test(voice.name)) ??
    pool[0]
  )
}
