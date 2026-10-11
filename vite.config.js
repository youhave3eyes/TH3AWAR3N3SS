import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  base: '/TH3AWAR3N3SS/',
  plugins: [react()],
  build: { cssMinify: false },
})
