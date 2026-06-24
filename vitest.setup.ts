import fs from 'fs'
import { closeDb } from './src/server/db/client'

const originalRmSync = fs.rmSync.bind(fs)

fs.rmSync = ((target: fs.PathLike, options?: fs.RmOptions) => {
  const targetText = String(target)
  if (targetText.includes('bloomai-')) {
    closeDb()
  }
  return originalRmSync(target, options)
}) as typeof fs.rmSync
