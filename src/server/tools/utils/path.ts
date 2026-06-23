import * as path from 'path'
import os from 'os'

export function resolveSafePath(p: string): string {
  const expanded = p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p
  return path.resolve(expanded)
}
