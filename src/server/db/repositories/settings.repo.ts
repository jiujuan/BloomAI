import { eq, inArray } from 'drizzle-orm'
import { getOrmDb } from '../client'
import { settings } from '../schema'


export const settingsRepo = {
  list(): Record<string, string> {
    const rows = getOrmDb().select({
      key: settings.key,
      value: settings.value,
    }).from(settings).all()

    return Object.fromEntries(rows.map((row) => [row.key, row.value]))
  },

  getValue(key: string): string | undefined {
    const row = getOrmDb().select({
      value: settings.value,
    }).from(settings).where(eq(settings.key, key)).get()

    return row?.value
  },

  setMany(values: Record<string, string>): number {
    const entries = Object.entries(values)
    const now = Date.now()

    for (const [key, value] of entries) {
      getOrmDb().insert(settings)
        .values({ key, value, updated_at: now })
        .onConflictDoUpdate({
          target: settings.key,
          set: { value, updated_at: now },
        })
        .run()
    }

    return entries.length
  },

  deleteMany(keys: string[]): number {
    const uniqueKeys = [...new Set(keys)]
    if (uniqueKeys.length === 0) return 0
    const result = getOrmDb().delete(settings)
      .where(inArray(settings.key, uniqueKeys))
      .run()
    return Number(result.changes ?? 0)
  },
}
