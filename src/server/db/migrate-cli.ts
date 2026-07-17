import { closeDb, runMigrations } from './client'

function requireDataDir(): void {
  if (process.env.DATA_DIR?.trim()) return
  throw new Error('[db:migrate] Refusing to run without an explicit DATA_DIR. Set DATA_DIR to the intended database directory.')
}

async function main() {
  requireDataDir()
  try {
    await runMigrations()
  } finally {
    closeDb()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
