import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('recharts')) return 'charts'
          if (id.includes('react')) return 'vendor'
          return undefined
        },
      },
    },
  },
})
