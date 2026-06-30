import type { Context } from 'hono'

/** Body parse that tolerates empty/no body (Express's json() defaulted to {}). */
export async function readJson<T = Record<string, any>>(c: Context): Promise<T> {
  try {
    return (await c.req.json()) as T
  } catch {
    return {} as T
  }
}

export function readIntQuery(c: Context, key: string, fallback: number): number {
  const parsed = parseInt(c.req.query(key) || '', 10)
  return Number.isFinite(parsed) ? parsed : fallback
}
