import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Vercel serves at the root domain; GitHub Pages serves under /satellite-channel-sim/.
  // Vercel sets VERCEL=1 during its build, so pick the base per target.
  base: process.env.VERCEL ? '/' : '/satellite-channel-sim/',
})
