<script lang="ts">
  import { afterUpdate, onMount } from 'svelte'
  import type { Readable } from 'svelte/store'
  import type { TableChatMessage } from '../multiplayer/chat'
  import { formatLocalTime, toUtcIso } from '../lib/time'
  import { config } from '../config'

  export let messages: Readable<TableChatMessage[]>
  export let sendChat: (text: string) => boolean
  export let deleteChat: (id: string) => void
  export let me: string
  export let nameFor: (playerID: string) => string
  /** Narrow screens start as a bubble; wide screens keep the side column open. */
  export let mode: 'lobby' | 'game' = 'lobby'
  /** Closed between deals and after the table ends. */
  export let enabled = true

  const desktopQuery = '(min-width: 900px)'
  let draft = ''
  let wide = typeof window !== 'undefined' && window.matchMedia(desktopQuery).matches
  let open = wide
  let listEl: HTMLElement | undefined
  let seenCount = 0
  let unread = 0

  $: lines = $messages
  $: if (open || wide) {
    seenCount = lines.length
    unread = 0
  } else if (lines.length > seenCount) {
    unread = lines.length - seenCount
  }

  onMount(() => {
    const mq = window.matchMedia(desktopQuery)
    const apply = () => {
      wide = mq.matches
      if (wide) open = true
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  })

  afterUpdate(() => {
    if (!(open || wide) || !listEl) return
    const node = listEl
    requestAnimationFrame(() => {
      node.scrollTop = node.scrollHeight
    })
  })

  function submit() {
    if (!enabled) return
    if (!sendChat(draft)) return
    draft = ''
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
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

<aside
  class="table-chat"
  class:lobby={mode === 'lobby'}
  class:game={mode === 'game'}
  class:open={open}
  class:wide={wide}
>
  {#if !wide && !open}
    <button type="button" class="chat-chip" on:click={toggle} aria-expanded={open}>
      Chat
      {#if unread > 0}<span class="chat-unread">{unread > 9 ? '9+' : unread}</span>{/if}
    </button>
  {/if}

  {#if open || wide}
    <div class="chat-panel" role="region" aria-label="Table chat">
      <header class="chat-head">
        <strong>Table chat</strong>
        {#if !wide}
          <button type="button" class="chat-close" on:click={toggle} aria-label="Close chat">✕</button>
        {/if}
      </header>

      <div class="chat-list" bind:this={listEl}>
        {#if !enabled}
          <p class="chat-empty">Chat is closed for this deal.</p>
        {:else if lines.length === 0}
          <p class="chat-empty">Say hi — everyone at this table can see it.</p>
        {:else}
          {#each lines as message (message.id)}
            <div class="chat-line" class:mine={message.sender === me}>
              <div class="chat-meta">
                <span class="chat-name">{message.sender === me ? 'You' : nameFor(message.sender)}</span>
                <time datetime={toUtcIso(message.at)}>{formatLocalTime(message.at)}</time>
                {#if message.sender === me}
                  <button
                    type="button"
                    class="chat-delete"
                    aria-label="Delete message"
                    on:click={() => deleteChat(message.id)}
                  >Delete</button>
                {/if}
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
          placeholder={enabled ? 'Message the table…' : 'Chat is closed'}
          autocomplete="off"
          enterkeyhint="send"
          disabled={!enabled}
          on:keydown={onKeydown}
        />
        <button type="submit" class="chat-send" disabled={!enabled || !draft.trim()}>Send</button>
      </form>
    </div>
  {/if}
</aside>
