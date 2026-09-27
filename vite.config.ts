import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte()],
  appType: 'spa',
  server: {
    host: true,
    proxy: {
      '/games': 'http://localhost:8000',
      '/auth': 'http://localhost:8000',
      '/api': 'http://localhost:8000',
      '/socket.io': {
        target: 'ws://localhost:8000',
        ws: true,
      },
    },
  },
})
