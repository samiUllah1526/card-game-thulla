<script lang="ts">
  import { onDestroy } from 'svelte'
  import Lobby from './components/Lobby.svelte'
  import GameTable from './components/GameTable.svelte'
  import type { Session } from './games/bhabhi-thulla/types'
  import { connectGame, type GameConnection } from './multiplayer/gameClient'
  import { clearSession, loadSession } from './multiplayer/lobby'

  let session: Session | null = loadSession()
  let connection: GameConnection | null = session ? connectGame(session) : null

  function join(nextSession: Session) {
    connection?.stop()
    session = nextSession
    connection = connectGame(nextSession)
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
{:else}
  <Lobby onJoined={join} />
{/if}
