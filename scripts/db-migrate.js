#!/usr/bin/env node

const { spawnSync } = require('node:child_process')
const path = require('node:path')

if (!process.env.DATA_DIR?.trim()) {
  console.error('[db:migrate] Refusing to run without an explicit DATA_DIR. Set DATA_DIR to the intended database directory.')
  process.exitCode = 1
} else {
  const projectRoot = path.resolve(__dirname, '..')
  const cli = path.join(projectRoot, 'src', 'server', 'db', 'migrate-cli.ts')
  const tsxCli = path.join(projectRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs')
  const result = spawnSync(process.execPath, [tsxCli, cli], {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit',
  })

  if (result.error) {
    console.error('[db:migrate] Failed to start migration runner:', result.error.message)
    process.exitCode = 1
  } else {
    process.exitCode = result.status ?? 1
  }
}
