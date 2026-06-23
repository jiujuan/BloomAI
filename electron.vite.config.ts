import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import path from 'path'

export default defineConfig({
  root: __dirname,
  plugins: [
    react(),
    electron([
      {
        entry: 'src/main/index.ts',
        vite: {
          build: { outDir: 'dist-electron', sourcemap: false },
        },
      },
      {
        entry: 'src/preload/index.ts',
        onstart(options) { options.reload() },
        vite: {
          build: { outDir: 'dist-electron', sourcemap: false },
        },
      },
    ]),
    renderer(),
  ],
  resolve: {
    alias: {
      '@main': path.resolve(__dirname, 'src/main'),
      '@preload': path.resolve(__dirname, 'src/preload'),
      '@renderer': path.resolve(__dirname, 'src/renderer'),
      '@server': path.resolve(__dirname, 'src/server'),
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'zustand', 'react-markdown', 'lucide-react'],
    exclude: ['electron'],
  },
})
