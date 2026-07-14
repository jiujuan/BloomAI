#!/usr/bin/env node
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')

/**
 * Force the Windows console used by `npm run dev` to UTF-8 before Vite/Electron
 * starts. Without this guard, terminals that still default to code page 936 (GBK)
 * can render Chinese logs from Vite, Electron, or the embedded server as mojibake.
 */
function ensureUtf8Console() {
  if (process.platform !== 'win32') return
  if (!process.stdout.isTTY && !process.stderr.isTTY) return

  const result = spawnSync('cmd.exe', ['/d', '/s', '/c', 'chcp 65001 > nul'], {
    stdio: 'ignore',
  })

  if (result.error) {
    console.warn('[dev] Unable to switch Windows console to UTF-8:', result.error.message)
  }
}

ensureUtf8Console()

const viteCli = path.join(path.dirname(require.resolve('vite/package.json')), 'bin', 'vite.js')
const args = [viteCli, '--config', 'electron.vite.config.ts', ...process.argv.slice(2)]
const env = {
  ...process.env,
  LANG: process.env.LANG || 'C.UTF-8',
  LC_ALL: process.env.LC_ALL || 'C.UTF-8',
  PYTHONIOENCODING: process.env.PYTHONIOENCODING || 'utf-8',
}

const child = spawn(process.execPath, args, {
  cwd: process.cwd(),
  env,
  stdio: 'inherit',
})

child.on('error', (error) => {
  console.error('[dev] Failed to start Vite:', error)
  process.exit(1)
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 1)
})
