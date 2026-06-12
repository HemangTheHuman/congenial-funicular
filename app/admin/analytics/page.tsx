import { auth } from '@/auth'
import { AnalyticsDashboardClient } from './AnalyticsDashboardClient'

export const dynamic = 'force-dynamic'

export default async function AnalyticsPage() {
  const session = await auth()
  if (!session?.user || session.user.role !== 'ADMIN') {
    return <div>Unauthorized</div>
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-6xl">
        <h1 className="text-2xl font-bold mb-6">Analytics & Monitoring</h1>
        <AnalyticsDashboardClient />
      </div>
    </div>
  )
}
