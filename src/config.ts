/**
 * Single source of configuration for the whole app (client + server).
 * Change values here only; nothing else should hard-code these numbers.
 */
export const config = {
  game: {
    /** boardgame.io game name; also used in lobby API URLs. */
    name: 'bhabhi-thulla',
    minPlayers: 3,
    maxPlayers: 8,
    /** How many recent events the server keeps in state. */
    eventHistory: 5,
  },

  shuffle: {
    minScale: 1,
    maxScale: 10,
    /** Default intensity — 10 matches a fully mixed deck. */
    defaultScale: 10,
    defaultAlgorithm: 'blendRandom' as const,
    algorithms: [
      {
        id: 'localMix' as const,
        label: 'Local mix',
        hint: 'Cards mostly stay near their original neighbors — a light table riffle.',
      },
      {
        id: 'blendRandom' as const,
        label: 'Blend to random',
        hint: 'Original order and a random order compete — mid settings mix the whole deck.',
      },
    ],
    /**
     * Verdict thresholds on orderScore (1 = still stacked, ~0 = random).
     * Checked from highest orderScore down.
     */
    verdicts: [
      { maxOrder: 0.85, id: 'stacked' as const, label: 'Stacked' },
      { maxOrder: 0.55, id: 'light' as const, label: 'Light mix' },
      { maxOrder: 0.3, id: 'mixed' as const, label: 'Mixed' },
      { maxOrder: 0.12, id: 'well' as const, label: 'Well shuffled' },
      { maxOrder: 0, id: 'random' as const, label: 'Random' },
    ],
  },

  timing: {
    /** A finished trick stays on the table at least this long before the winner can lead. */
    trickDisplayMinMs: 2000,
    /** A finished trick is cleared from the table after this long even if nobody plays. */
    trickDisplayMaxMs: 10000,
    /** Duration of a single picked-up card flying to the receiver. */
    pickupFlyMs: 650,
    /** Delay between each picked-up card starting its flight. */
    pickupFlyStaggerMs: 70,
    /** How long received cards glow in the receiver's hand. */
    receivedGlowMs: 2600,
    /** How often the table refreshes player names from the lobby API. */
    seatPollMs: 2500,
    /** "Copied!" feedback after tapping the game code. */
    copiedFeedbackMs: 1500,
    /** Full-name tooltip stays open this long after a tap on a player chip. */
    nameTipMs: 2200,
  },

  server: {
    defaultPort: 8000,
    /** Allowed browser origins when CLIENT_ORIGINS env is not set. */
    defaultOrigins: ['*'],
  },

  storage: {
    sessionKey: 'bhabhi-session',
  },
} as const

export type AppConfig = typeof config
