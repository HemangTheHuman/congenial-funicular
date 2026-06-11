import { db } from '@/lib/db'
import { testConnection as testLS } from '@/lib/labelStudio'

export const dynamic = 'force-dynamic'

async function testTurso(): Promise<boolean> {
  try {
    await db.execute('SELECT 1')
    return true
  } catch {
    return false
  }
}

export async function GET() {
  const [turso, labelStudio] = await Promise.allSettled([
    testTurso(),
    testLS(),
  ])

  const result = {
    database:   turso.status === 'fulfilled'       && turso.value       ? 'ok' : 'error',
    labelStudio: labelStudio.status === 'fulfilled' && labelStudio.value ? 'ok' : 'error',
    databaseError:
      turso.status === 'rejected' ? (turso.reason as Error).message : undefined,
    labelStudioError:
      labelStudio.status === 'rejected' ? (labelStudio.reason as Error).message : undefined,
    timestamp: new Date().toISOString(),
  }

  const allOk = result.database === 'ok' && result.labelStudio === 'ok'
  return Response.json(result, { status: allOk ? 200 : 503 })
}
