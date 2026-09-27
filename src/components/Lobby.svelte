<script lang="ts">
  import { config } from '../config'
  import { seatsToFill } from '../bots/plan'
  import { createMatch, getSeats, joinMatch, saveSession } from '../multiplayer/lobby'
  import { fillBots } from '../multiplayer/authClient'
  import {
    fetchAuthProviders,
    fetchMatchGate,
    login,
    loginWithGoogle,
    logout,
    reclaimSeat,
    signup,
  } from '../multiplayer/authClient'
  import type { PublicUser } from '../multiplayer/authTypes'
  import type { LobbySeat, Session } from '../games/bhabhi-thulla/types'

  export let onJoined: (session: Session) => void
  export let onWatch: (matchID: string) => void = () => {}
  export let user: PublicUser | null = null
  export let onUser: (user: PublicUser | null) => void = () => {}

  const seatOptions = Array.from(
    { length: config.game.maxPlayers - config.game.minPlayers + 1 },
    (_, index) => config.game.minPlayers + index,
  )
  const algorithms = config.shuffle.algorithms

  let tab: 'create' | 'join' | 'account' = 'create'
  let playerName = ''
  let playerCount = Math.min(4, config.game.maxPlayers)
  let shuffleAlgorithm: string = config.shuffle.defaultAlgorithm
  let shuffleScale = config.shuffle.defaultScale
  let takeMode: 'free' | 'ask' = config.game.defaultTakeRequiresPermission ? 'ask' : 'free'
  let botChoice = '0'
  let botDifficulty = config.bots.levels[1]?.id ?? config.bots.levels[0].id
  let matchID = ''
  let seats: LobbySeat[] = []
  let selectedSeat = ''
  let loading = false
  let createError = ''
  let joinError = ''
  let watchable = false
  let openSeatCount: number = config.game.maxPlayers
  let authMode: 'signin' | 'signup' = 'signin'
  let authEmail = ''
  let authPassword = ''
  let authName = ''
  let authError = ''
  let authLoading = false
  let googleClientId: string | null = null
  let providersRequested = false

  $: selectedAlgo = algorithms.find((entry) => entry.id === shuffleAlgorithm) ?? algorithms[0]
  $: botSeatMax = Math.max(0, Number(playerCount) - 1)
  $: botChoices = [
    { id: '0', label: 'No bots' },
    ...Array.from({ length: botSeatMax }, (_, index) => ({
      id: String(index + 1),
      label: index === 0 ? '1 bot' : `${index + 1} bots`,
    })),
    ...(botSeatMax > 0 ? [{ id: 'rest', label: 'Everyone but me' }] : []),
  ]
  $: if (!botChoices.some((choice) => choice.id === botChoice)) botChoice = '0'
  $: if (user) playerName = user.displayName
  $: if (tab === 'account' && !user) void loadProviders()

  async function create() {
    if (!playerName.trim()) {
      createError = 'Enter your name first.'
      return
    }
    loading = true
    createError = ''
    try {
      const session = await createMatch(playerName.trim(), playerCount, {
        shuffleAlgorithm,
        shuffleScale,
        takeRequiresPermission: takeMode === 'ask',
      })
      saveSession(session)
      const botSeats = seatsToFill(Number(playerCount), botChoice)
      if (botSeats.length > 0) {
        try {
          await fillBots(session, botSeats, botDifficulty)
        } catch (reason) {
          const detail = reason instanceof Error ? reason.message : 'The bots could not sit.'
          createError = `Table ${session.matchID} is open, but ${detail} Join that code and seat them from the waiting room.`
          return
        }
      }
      onJoined(session)
    } catch (reason) {
      createError = reason instanceof Error ? reason.message : 'Could not create the game.'
    } finally {
      loading = false
    }
  }

  async function findGame() {
    const id = matchID.trim()
    if (!id) return
    loading = true
    joinError = ''
    watchable = false
    seats = []
    try {
      const gate = await fetchMatchGate(id)
      if (gate.closed) {
        joinError = 'This table has ended.'
        return
      }
      if (user) {
        try {
          const session = await reclaimSeat(id)
          saveSession(session)
          onJoined(session)
          return
        } catch {
          // This account has no seat on the table.
        }
      }
      openSeatCount = gate.seatCount || config.game.maxPlayers
      if (gate.started) {
        watchable = true
        joinError = 'This game has already started.'
        return
      }
      watchable = true
      seats = (await getSeats(id)).filter((seat) => seat.id < openSeatCount)
      selectedSeat = String(seats.find((seat) => !seat.name)?.id ?? '')
      if (!selectedSeat) joinError = 'This game is full.'
    } catch (reason) {
      seats = []
      watchable = false
      joinError = reason instanceof Error ? reason.message : 'Game not found.'
    } finally {
      loading = false
    }
  }

  async function join() {
    if (!playerName.trim() || !selectedSeat) {
      joinError = 'Enter your name and choose an empty seat.'
      return
    }
    loading = true
    joinError = ''
    try {
      const session = await joinMatch(matchID.trim(), selectedSeat, playerName.trim())
      saveSession(session)
      onJoined(session)
    } catch (reason) {
      joinError = reason instanceof Error ? reason.message : 'Could not join the game.'
    } finally {
      loading = false
    }
  }

  async function submitAuth() {
    authLoading = true
    authError = ''
    try {
      const next =
        authMode === 'signup'
          ? await signup(authEmail, authPassword, authName)
          : await login(authEmail, authPassword)
      onUser(next)
      authPassword = ''
      tab = 'create'
    } catch (reason) {
      authError = reason instanceof Error ? reason.message : 'Could not sign in.'
    } finally {
      authLoading = false
    }
  }

  async function loadProviders() {
    if (providersRequested) return
    providersRequested = true
    try {
      googleClientId = (await fetchAuthProviders()).googleClientId
    } catch {
      googleClientId = null
    }
  }

  async function signInWithGoogle(credential: string) {
    if (authLoading) return
    authLoading = true
    authError = ''
    try {
      onUser(await loginWithGoogle(credential))
      tab = 'create'
    } catch (reason) {
      authError = reason instanceof Error ? reason.message : 'Could not sign in.'
    } finally {
      authLoading = false
    }
  }

  function mountGoogleButton(node: HTMLElement, clientId: string) {
    let cancelled = false
    void loadGsiScript()
      .then(() => {
        if (cancelled) return
        const identity = googleIdentity()
        if (!identity) throw new Error('Could not load Google sign-in.')
        identity.initialize({
          client_id: clientId,
          auto_select: false,
          callback: (response) => {
            if (response.credential) void signInWithGoogle(response.credential)
          },
        })
        // Medium stays "Continue with Google". Large swaps in the browser's Gmail.
        const width = Math.max(240, Math.min(400, Math.floor(node.clientWidth || 320)))
        identity.renderButton(node, {
          type: 'standard',
          theme: 'outline',
          size: 'medium',
          text: 'continue_with',
          width,
          logo_alignment: 'left',
        })
      })
      .catch((reason: unknown) => {
        authError = reason instanceof Error ? reason.message : 'Could not load Google sign-in.'
      })
    return {
      destroy() {
        cancelled = true
        node.replaceChildren()
      },
    }
  }

  async function signOut() {
    authLoading = true
    authError = ''
    try {
      await logout()
      onUser(null)
    } catch (reason) {
      authError = reason instanceof Error ? reason.message : 'Could not sign out.'
    } finally {
      authLoading = false
    }
  }

  interface GoogleIdentity {
    initialize(config: {
      client_id: string
      auto_select: boolean
      callback: (response: { credential?: string }) => void
    }): void
    renderButton(parent: HTMLElement, options: Record<string, string | number>): void
  }

  function googleIdentity(): GoogleIdentity | null {
    const google = (window as Window & { google?: { accounts?: { id?: GoogleIdentity } } }).google
    return google?.accounts?.id ?? null
  }

  let gsiScript: Promise<void> | null = null

  function loadGsiScript(): Promise<void> {
    if (googleIdentity()) return Promise.resolve()
    if (!gsiScript) {
      gsiScript = new Promise((resolve, reject) => {
        const script = document.createElement('script')
        script.src = 'https://accounts.google.com/gsi/client'
        script.async = true
        script.onload = () => resolve()
        script.onerror = () => reject(new Error('Could not load Google sign-in.'))
        document.head.appendChild(script)
      })
    }
    return gsiScript
  }
</script>

<main class="lobby page">
  <header class="brand">
    <div class="logo-mark">{config.game.mark}</div>
    <div>
      <p class="eyebrow">The classic escape game</p>
      <h1>{config.game.title}</h1>
    </div>
  </header>

  <section class="hero-card">
    <span class="mini-card red">A♥</span>
    <div>
      <h2>First one out wins.</h2>
      <p>Follow suit, avoid the Thulla, and don’t be the last player holding cards.</p>
    </div>
    <span class="mini-card black">A♠</span>
  </section>

  <div class="lobby-tabs" role="tablist">
    <button type="button" role="tab" aria-selected={tab === 'create'} class:active={tab === 'create'} on:click={() => (tab = 'create')}>Create</button>
    <button type="button" role="tab" aria-selected={tab === 'join'} class:active={tab === 'join'} on:click={() => (tab = 'join')}>Join</button>
    <button type="button" role="tab" aria-selected={tab === 'account'} class:active={tab === 'account'} on:click={() => (tab = 'account')}>Account</button>
  </div>

  {#if user}
    <p class="signed-in-line">Signed in as <strong>{user.displayName}</strong></p>
  {/if}

  {#if tab === 'create'}
    <section class="panel" role="tabpanel">
      <div class="section-title">
        <span class="step">1</span>
        <div><h2>Create a table</h2><p>Invite friends with a game code.</p></div>
      </div>
      <label>
        <span>Your name</span>
        <input
          bind:value={playerName}
          maxlength="24"
          placeholder="Enter a display name"
          disabled={!!user}
        />
      </label>
      <label>
        <span>Starting seats</span>
        <select bind:value={playerCount}>
          {#each seatOptions as count}
            <option value={count}>{count} players</option>
          {/each}
        </select>
      </label>
      <p class="join-hint">Add a seat later, or start once 3 seats are filled. Bots count.</p>
      <label>
        <span>Bot seats</span>
        <select bind:value={botChoice}>
          {#each botChoices as choice}
            <option value={choice.id}>{choice.label}</option>
          {/each}
        </select>
      </label>
      {#if botChoice !== '0'}
        <label>
          <span>Bot difficulty</span>
          <select bind:value={botDifficulty}>
            {#each config.bots.levels as level}
              <option value={level.id}>{level.label}</option>
            {/each}
          </select>
        </label>
        <p class="join-hint">{config.bots.levels.find((level) => level.id === botDifficulty)?.hint}</p>
      {/if}
      <label>
        <span>Shuffle method</span>
        <select bind:value={shuffleAlgorithm}>
          {#each algorithms as algo}
            <option value={algo.id}>{algo.label}</option>
          {/each}
        </select>
      </label>
      <label class="scale-label">
        <span class="scale-head">
          <span>Shuffle intensity</span>
          <strong>{shuffleScale}/{config.shuffle.maxScale}</strong>
        </span>
        <input
          type="range"
          min={config.shuffle.minScale}
          max={config.shuffle.maxScale}
          step="1"
          bind:value={shuffleScale}
        />
        <span class="scale-ends"><span>Stacked</span><span>Random</span></span>
        <p class="scale-hint">{selectedAlgo.hint}</p>
      </label>
      <fieldset class="take-mode">
        <legend>Taking cards</legend>
        <label class="radio-option">
          <input type="radio" bind:group={takeMode} value="free" />
          <span>
            <strong>Free take</strong>
            <small>Leader can take the next player's hand immediately</small>
          </span>
        </label>
        <label class="radio-option">
          <input type="radio" bind:group={takeMode} value="ask" />
          <span>
            <strong>Ask permission</strong>
            <small>Next player must Accept or Reject before cards move</small>
          </span>
        </label>
      </fieldset>
      <button class="primary" on:click={create} disabled={loading}>Create game</button>
      {#if createError}<p class="error" role="alert">{createError}</p>{/if}
    </section>
  {:else if tab === 'join'}
    <section class="panel" role="tabpanel">
      <div class="section-title">
        <span class="step">2</span>
        <div><h2>Join a table</h2><p>Ask the host for their code.</p></div>
      </div>
      <label>
        <span>Your name</span>
        <input
          bind:value={playerName}
          maxlength="24"
          placeholder="Enter a display name"
          disabled={!!user}
        />
      </label>
      <div class="join-row">
        <input bind:value={matchID} placeholder="Game code" autocapitalize="off" />
        <button class="secondary" on:click={findGame} disabled={loading || !matchID.trim()}>
          Find
        </button>
      </div>
      {#if seats.length}
        <label>
          <span>Choose an empty seat</span>
          <select bind:value={selectedSeat}>
            {#each seats.filter((seat) => !seat.name) as seat}
              <option value={String(seat.id)}>Seat {seat.id + 1}</option>
            {/each}
          </select>
        </label>
        <button class="primary" on:click={join} disabled={loading || !selectedSeat}>Sit down</button>
      {/if}
      {#if watchable}
        <button
          class={seats.length ? 'secondary' : 'primary'}
          type="button"
          on:click={() => onWatch(matchID.trim())}
        >Watch</button>
      {/if}
      {#if joinError}<p class="error" role="alert">{joinError}</p>{/if}
    </section>
  {:else}
    <section class="panel auth-panel" role="tabpanel">
      {#if user}
        <div class="auth-signed-in">
          <p>Signed in as <strong>{user.displayName}</strong></p>
          <button class="secondary" type="button" on:click={signOut} disabled={authLoading}>Sign out</button>
        </div>
      {:else}
        {#if googleClientId}
          <div class="google-signin" use:mountGoogleButton={googleClientId}></div>
        {/if}
        <div class="auth-tabs" role="tablist">
          <button
            type="button"
            class:active={authMode === 'signin'}
            on:click={() => (authMode = 'signin')}
          >Sign in</button>
          <button
            type="button"
            class:active={authMode === 'signup'}
            on:click={() => (authMode = 'signup')}
          >Sign up</button>
        </div>
        <form class="auth-form" on:submit|preventDefault={submitAuth}>
          <label>
            <span>Email</span>
            <input type="email" bind:value={authEmail} autocomplete="email" required />
          </label>
          {#if authMode === 'signup'}
            <label>
              <span>Display name</span>
              <input bind:value={authName} maxlength={config.auth.maxDisplayName} autocomplete="nickname" required />
            </label>
          {/if}
          <label>
            <span>Password</span>
            <input
              type="password"
              bind:value={authPassword}
              minlength={config.auth.minPasswordLength}
              autocomplete={authMode === 'signup' ? 'new-password' : 'current-password'}
              required
            />
          </label>
          <button class="primary" type="submit" disabled={authLoading}>
            {authMode === 'signup' ? 'Create account' : 'Sign in'}
          </button>
        </form>
        <p class="auth-hint">Optional — guests can still play with a display name.</p>
      {/if}
      {#if authError}<p class="error" role="alert">{authError}</p>{/if}
    </section>
  {/if}

  <p class="footnote">{config.game.minPlayers}–{config.game.maxPlayers} seats · Empty seats can be bots · Each person uses their own phone</p>
</main>
