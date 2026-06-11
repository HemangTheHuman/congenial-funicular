import { createClient } from '@libsql/client'

// Singleton Turso/libSQL client.
// Uses the HTTP transport — works on Vercel Edge/Serverless without native addons.
// TURSO_DATABASE_URL: libsql://your-db.turso.io
// TURSO_AUTH_TOKEN:   JWT from `turso db tokens create`

if (!process.env.TURSO_DATABASE_URL) {
  throw new Error('Missing TURSO_DATABASE_URL environment variable')
}
if (!process.env.TURSO_AUTH_TOKEN) {
  throw new Error('Missing TURSO_AUTH_TOKEN environment variable')
}

export const db = createClient({
  url:       process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
})
