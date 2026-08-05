import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import path from 'path'
import { builtinModules } from 'node:module'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const localAliases = ['@main/', '@preload/', '@renderer/', '@server/', '@shared/']
const aliases = {
  '@main': path.resolve(__dirname, 'src/main'),
  '@preload': path.resolve(__dirname, 'src/preload'),
  '@renderer': path.resolve(__dirname, 'src/renderer'),
  '@server': path.resolve(__dirname, 'src/server'),
  '@shared': path.resolve(__dirname, 'src/shared'),
}

function externalizeServerDependencies(id: string): boolean {
  if (id.startsWith('node:') || builtinModules.includes(id) || id === 'electron') return true
  if (id.startsWith('.') || path.isAbsolute(id)) return false
  if (localAliases.some((alias) => id.startsWith(alias))) return false
  return true
}

export default defineConfig({
  root: __dirname,
  plugins: [
    react(),
    electron([
      {
        entry: { main: 'src/main/index.ts' },
        vite: {
          build: { outDir: 'dist-electron', sourcemap: false },
        },
      },
      {
        entry: { preload: 'src/preload/index.ts' },
        onstart(options) { options.reload() },
        vite: {
          build: { outDir: 'dist-electron', sourcemap: false },
        },
      },
      {
        entry: { server: 'src/server/index.ts' },
        vite: {
          resolve: { alias: aliases },
          build: {
            outDir: 'dist-electron/server',
            sourcemap: false,
            lib: {
              entry: 'src/server/index.ts',
              formats: ['cjs'],
              fileName: () => 'index.js',
            },
            rollupOptions: {
              external: externalizeServerDependencies,
            },
          },
        },
      },
    ]),
    renderer(),
  ],
  resolve: {
    alias: aliases,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          markdown: ['react-markdown', 'remark-gfm'],
          icons: ['lucide-react'],
        },
      },
    },
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
