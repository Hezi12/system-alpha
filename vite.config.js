import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './', // Important for Electron
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
        }
      }
    },
    // Optimize for production
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: false, // Keep console for debugging
      }
    },
    // Increase chunk size warning limit
    chunkSizeWarningLimit: 1000,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  // Optimize dependencies
  optimizeDeps: {
    include: ['react', 'react-dom', 'lucide-react'],
  },
  // Worker configuration for better performance
  worker: {
    format: 'es',
    plugins: [],
    rollupOptions: {
      output: {
        format: 'es'
      }
    }
  }
})


