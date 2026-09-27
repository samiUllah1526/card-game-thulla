<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { config } from '../config'
  import type { LobbySeat, Session } from '../games/bhabhi-thulla/types'
  import type { PublicUser } from '../multiplayer/authTypes'
  import { fetchMatchGate, reclaimSeat } from '../multiplayer/authClient'
  import { linkOffer } from '../multiplayer/linkOffer'
  import {
    firstEmptySeat,
    getSeats,
    joinMatch,
    nextGuestName,
    saveSession,
  } from '../multiplayer/lobby'

  export let code: string
  export let user: PublicUser | null = null
  export let onJoined: (session: Session) => void
  export let onBack: () => void
  export let onEnded: () => void = () => {}
  export let onWatch: () => void = () => {}

  let seats: LobbySeat[] = []
  let guestName = ''
  let loading = false
  let error = ''
  let missing = false
  let started = false
  let checked = false
  let reclaimAttempted = false
  let poll: number | undefined

  $: suggestedGuest = nextGuestName(seats)
  $: emptySeat = firstEmptySeat(seats)
  $: offer = linkOffer({
    closed: false,
    started,
    missing,
    hasEmptySeat: !!emptySeat,
    reclaimed: false,
  })
  $: canJoin = offer.sit && !loading

  async function refresh() {
    try {
      const gate = await fetchMatchGate(code)
      if (gate.closed) {
        onEnded()
        return
      }
      if (user && !reclaimAttempted) {
        reclaimAttempted = true
        try {
          const session = await reclaimSeat(code)
          saveSession(session)
          onJoined(session)
          return
        } catch {
          // This account has no seat on the table.
        }
      }
      if (gate.started) {
        started = true
        seats = []
        error = 'This game has already started.'
        return
      }
      started = false
      seats = await getSeats(code)
      missing = false
      if (error === 'That table was not found.') error = ''
    } catch {
      seats = []
      missing = true
      error = 'That table was not found.'
    } finally {
      checked = true
    }
  }

  async function join() {
    if (!canJoin || !emptySeat) {
      error = missing ? 'That table was not found.' : 'This table is full.'
      return
    }
    const name = user ? user.displayName : guestName.trim() || nextGuestName(seats)
    loading = true
    error = ''
    try {
      const session = await joinMatch(code, String(emptySeat.id), name)
      saveSession(session)
      onJoined(session)
    } catch (reason) {
      error = reason instanceof Error ? reason.message : 'Could not join this table.'
      await refresh()
    } finally {
      loading = false
    }
  }

  onMount(() => {
    void refresh()
    poll = window.setInterval(() => void refresh(), config.timing.seatPollMs)
  })

  onDestroy(() => {
    if (poll) window.clearInterval(poll)
  })
</script>

<main class="lobby page join-page">
  <header class="brand">
    <div class="logo-mark">{config.game.mark}</div>
    <div>
      <p class="eyebrow">Join a table</p>
      <h1>{config.game.title}</h1>
    </div>
  </header>

  <section class="panel">
    <div class="section-title">
      <span class="step">+</span>
      <div>
        <h2>Game {code}</h2>
        <p>
          {#if !checked}
            Checking the table…
          {:else if started}
            The invitation is closed. You can still watch.
          {:else}
            Sit down takes an empty seat. Watch follows the table from the side.
          {/if}
        </p>
      </div>
    </div>

    {#if checked && !started && seats.length}
      <div class="seat-list join-seats">
        {#each seats as seat}
          <div class:filled={!!seat.name}>
            <span>{seat.name ? seat.name.slice(0, 1) : seat.id + 1}</span>
            <p>{seat.name ?? 'Empty'}</p>
          </div>
        {/each}
      </div>
    {/if}

    {#if checked && !started && user}
      <p class="signed-in-line">You’ll join as <strong>{user.displayName}</strong></p>
    {:else if checked && !started}
      <label>
        <span>Your name</span>
        <input
          bind:value={guestName}
          maxlength="24"
          placeholder="Leave blank to join as {suggestedGuest}"
          autocomplete="nickname"
        />
      </label>
      <p class="join-hint">Leave blank to join as {suggestedGuest}.</p>
    {/if}

    {#if checked && offer.sit}
      <button class="primary" type="button" on:click={join} disabled={!canJoin}>
        Sit down
      </button>
    {:else if checked && !started && !missing}
      <button class="primary" type="button" disabled>Sit down</button>
    {/if}
    {#if checked && offer.watch}
      <button class={started ? 'primary' : 'secondary'} type="button" on:click={onWatch}>
        Watch
      </button>
    {/if}
    <button class="secondary" type="button" on:click={onBack}>Back</button>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  </section>
</main>
