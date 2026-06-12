import { auth } from '@/auth'
import { getTaskFunnel, getUserProductivity, getQualityMetrics, getActiveLocks } from '@/lib/analytics'
import type { AnalyticsDateRange } from '@/lib/analytics'

export const dynamic = 'force-dynamic'

export const GET = auth(async (req) => {
  const session = req.auth
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'ADMIN') return Response.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const start = searchParams.get('start') || undefined
  const end = searchParams.get('end') || undefined

  const range: AnalyticsDateRange = { start, end }

  try {
    const [funnelData, productivity, quality, activeLocks] = await Promise.all([
      getTaskFunnel(range),
      getUserProductivity(range),
      getQualityMetrics(range),
      getActiveLocks()
    ])

    return Response.json({
      funnel: funnelData.funnel,
      totalTasks: funnelData.total,
      productivity,
      quality,
      activeLocks
    })
  } catch (err: any) {
    console.error('[Analytics API] Error:', err)
    return Response.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
})
