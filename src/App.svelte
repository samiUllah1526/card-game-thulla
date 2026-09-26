<script lang="ts">
  import { onDestroy } from 'svelte'
  import Lobby from './components/Lobby.svelte'
  import JoinGame from './components/JoinGame.svelte'
  import GameTable from './components/GameTable.svelte'
  import type { Session } from './games/bhabhi-thulla/types'
  import { connectGame, type GameConnection } from './multiplayer/gameClient'
  import { fetchMe } from './multiplayer/authClient'
  import type { PublicUser } from './multiplayer/authTypes'
  import { clearSession, loadSession, parseJoinPath } from './multiplayer/lobby'

  const joinCodeAtLoad = parseJoinPath()
  const stored = loadSession()
  const reconnect = stored && (!joinCodeAtLoad || stored.matchID === joinCodeAtLoad) ? stored : null

  let joinCode: string | null = reconnect ? null : joinCodeAtLoad
  let session: Session | null = reconnect
  let connection: GameConnection | null = session ? connectGame(session) : null
  let user: PublicUser | null = null
  let authReady = false

  if (reconnect && joinCodeAtLoad) {
    history.replaceState({}, '', '/')
  }

  void fetchMe()
    .then((next) => {
      user = next
    })
    .catch(() => {
      user = null
    })
    .finally(() => {
      authReady = true
    })

  function sitDown(nextSession: Session) {
    connection?.stop()
    session = nextSession
    connection = connectGame(nextSession)
    joinCode = null
    if (parseJoinPath()) history.replaceState({}, '', '/')
  }

  function leaveJoinPage() {
    joinCode = null
    if (parseJoinPath()) history.replaceState({}, '', '/')
    const existing = loadSession()
    if (existing) sitDown(existing)
  }

  function leave() {
    connection?.stop()
    connection = null
    session = null
    clearSession()
  }

  onDestroy(() => connection?.stop())
</script>

{#if session && connection}
  <GameTable {session} {connection} onLeave={leave} />
{:else if joinCode}
  {#if authReady}
    <JoinGame
      code={joinCode}
      {user}
      onJoined={sitDown}
      onBack={leaveJoinPage}
    />
  {/if}
{:else}
  <Lobby {user} onUser={(next) => (user = next)} onJoined={sitDown} />
{/if}
