import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        // Prevent proxy from timing out on long SSE streams (video download + transcription)
        proxyTimeout: 0,
        timeout: 0,
        configure: (proxy) => {
          // Forward SSE streams without buffering
          proxy.on('proxyRes', (proxyRes) => {
            if (proxyRes.headers['content-type']?.includes('text/event-stream')) {
              proxyRes.headers['x-accel-buffering'] = 'no'
              proxyRes.headers['cache-control'] = 'no-cache'
            }
          })
          proxy.on('error', (err, _req, res) => {
            if (res.headersSent) return
            res.writeHead(502, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ detail: err.message }))
          })
        },
      },
    },
  },
})
