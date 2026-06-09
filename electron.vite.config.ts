import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    // electron-vite externalizes every package.json dep by default so the
    // main bundle stays tiny and runtime `require()`s them. That breaks
    // for ESM-only packages (pi-agent-core, pi-ai) which can't be CJS-
    // required. Exclude them so they get bundled INTO the main chunk
    // instead of resolved at runtime.
    plugins: [
      externalizeDepsPlugin({
        exclude: ['@earendil-works/pi-agent-core', '@earendil-works/pi-ai'],
      }),
    ],
  },
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
      },
    },
    plugins: [tailwindcss(), react()],
  },
})
