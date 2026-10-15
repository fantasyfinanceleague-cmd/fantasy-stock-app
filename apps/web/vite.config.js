import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { universalLinks } from './vite-plugins/universalLinks'
import universalLinksConfig from './universal-links.config.json' with { type: 'json' }

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), universalLinks(universalLinksConfig, process.env, fileURLToPath(new URL('./vercel.json', import.meta.url)))],
})
