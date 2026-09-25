<script lang="ts">
  import { createMatch, getSeats, joinMatch, saveSession } from '../multiplayer/lobby'
  import type { LobbySeat, Session } from '../games/bhabhi-thulla/types'

  export let onJoined: (session: Session) => void

  let playerName = ''
  let playerCount = 4
  let matchID = ''
  let seats: LobbySeat[] = []
  let selectedSeat = ''
  let loading = false
  let error = ''

  async function create() {
    if (!playerName.trim()) {
      error = 'Enter your name first.'
      return
    }
    loading = true
    error = ''
    try {
      const session = await createMatch(playerName.trim(), playerCount)
      saveSession(session)
      onJoined(session)
    } catch (reason) {
      error = reason instanceof Error ? reason.message : 'Could not create the game.'
    } finally {
      loading = false
    }
  }

  async function findGame() {
    if (!matchID.trim()) return
    loading = true
    error = ''
    try {
      seats = await getSeats(matchID.trim())
      selectedSeat = String(seats.find((seat) => !seat.name)?.id ?? '')
      if (!selectedSeat) error = 'This game is full.'
    } catch (reason) {
      seats = []
      error = reason instanceof Error ? reason.message : 'Game not found.'
    } finally {
      loading = false
    }
  }

  async function join() {
    if (!playerName.trim() || !selectedSeat) {
      error = 'Enter your name and choose an empty seat.'
      return
    }
    loading = true
    error = ''
    try {
      const session = await joinMatch(matchID.trim(), selectedSeat, playerName.trim())
      saveSession(session)
      onJoined(session)
    } catch (reason) {
      error = reason instanceof Error ? reason.message : 'Could not join the game.'
    } finally {
      loading = false
    }
  }
</script>

<main class="lobby page">
  <header class="brand">
    <div class="logo-mark">BT</div>
    <div>
      <p class="eyebrow">The classic escape game</p>
      <h1>Bhabhi Thulla</h1>
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

  <label>
    <span>Your name</span>
    <input bind:value={playerName} maxlength="24" placeholder="Enter a display name" />
  </label>

  <section class="panel">
    <div class="section-title">
      <span class="step">1</span>
      <div><h2>Create a table</h2><p>Invite friends with a game code.</p></div>
    </div>
    <label>
      <span>Number of seats</span>
      <select bind:value={playerCount}>
        {#each [3, 4, 5, 6, 7, 8] as count}
          <option value={count}>{count} players</option>
        {/each}
      </select>
    </label>
    <button class="primary" on:click={create} disabled={loading}>Create game</button>
  </section>

  <div class="divider"><span>or join friends</span></div>

  <section class="panel">
    <div class="section-title">
      <span class="step">2</span>
      <div><h2>Join a table</h2><p>Ask the host for their code.</p></div>
    </div>
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
      <button class="primary" on:click={join} disabled={loading || !selectedSeat}>Join game</button>
    {/if}
  </section>

  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <p class="footnote">3–8 human players · Each player uses their own phone</p>
</main>
