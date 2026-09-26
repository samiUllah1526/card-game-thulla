<script lang="ts">
  import { afterUpdate, onMount } from 'svelte'
  import type { Readable } from 'svelte/store'
  import type { TableChatMessage } from '../multiplayer/chat'
  import { config } from '../config'

  export let messages: Readable<TableChatMessage[]>
  export let sendChat: (text: string) => boolean
  export let me: string
  export let nameFor: (playerID: string) => string
  /** Lobby keeps chat open on phones; in-game starts collapsed (sheet). */
  export let mode: 'lobby' | 'game' = 'lobby'

  let draft = ''
  let open = mode === 'lobby'
  let listEl: HTMLElement | undefined
  let seenCount = 0
  let unread = 0
  let wide = false

  $: lines = $messages
  $: if (open || wide) {
    seenCount = lines.length
    unread = 0
  } else if (lines.length > seenCount) {
    unread = lines.length - seenCount
  }

  onMount(() => {
    const mq = window.matchMedia('(min-width: 900px)')
    const apply = () => {
      wide = mq.matches
      if (wide) open = true
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  })

  afterUpdate(() => {
    if ((open || wide) && listEl) {
      listEl.scrollTop = listEl.scrollHeight
    }
  })

  function submit() {
    if (!sendChat(draft)) return
    draft = ''
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  function formatTime(at: number): string {
    try {
      return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    } catch {
      return ''
    }
  }

  function toggle() {
    open = !open
    if (open) {
      seenCount = lines.length
      unread = 0
    }
  }
</script>

<aside class="table-chat" class:lobby={mode === 'lobby'} class:game={mode === 'game'} class:open class:wide>
  {#if mode === 'game' && !wide}
    <button type="button" class="chat-chip" on:click={toggle} aria-expanded={open}>
      Chat
      {#if unread > 0}<span class="chat-unread">{unread > 9 ? '9+' : unread}</span>{/if}
    </button>
  {/if}

  {#if open || wide || mode === 'lobby'}
    <div class="chat-panel" role="region" aria-label="Table chat">
      <header class="chat-head">
        <strong>Table chat</strong>
        {#if mode === 'game' && !wide}
          <button type="button" class="chat-close" on:click={toggle} aria-label="Close chat">✕</button>
        {/if}
      </header>

      <div class="chat-list" bind:this={listEl}>
        {#if lines.length === 0}
          <p class="chat-empty">Say hi — everyone at this table can see it.</p>
        {:else}
          {#each lines as message (message.id)}
            <div class="chat-line" class:mine={message.sender === me}>
              <div class="chat-meta">
                <span class="chat-name">{message.sender === me ? 'You' : nameFor(message.sender)}</span>
                <time datetime={new Date(message.at).toISOString()}>{formatTime(message.at)}</time>
              </div>
              <p class="chat-text">{message.text}</p>
            </div>
          {/each}
        {/if}
      </div>

      <form class="chat-compose" on:submit|preventDefault={submit}>
        <input
          bind:value={draft}
          maxlength={config.chat.maxLength}
          placeholder="Message the table…"
          autocomplete="off"
          enterkeyhint="send"
          on:keydown={onKeydown}
        />
        <button type="submit" class="chat-send" disabled={!draft.trim()}>Send</button>
      </form>
    </div>
  {/if}
</aside>
