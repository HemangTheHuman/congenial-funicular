'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Loader2, Unlock, Calendar, Users, Target, Activity } from 'lucide-react'

type DateRangeFilter = 'ALL_TIME' | 'TODAY' | 'LAST_7_DAYS'

export function AnalyticsDashboardClient() {
  const [filter, setFilter] = useState<DateRangeFilter>('ALL_TIME')
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [unlocking, setUnlocking] = useState<string | null>(null)

  const fetchData = async () => {
    setLoading(true)
    let url = '/api/admin/analytics'
    
    if (filter !== 'ALL_TIME') {
      const now = new Date()
      let start = new Date()
      if (filter === 'TODAY') {
        start.setHours(0, 0, 0, 0)
      } else if (filter === 'LAST_7_DAYS') {
        start.setDate(now.getDate() - 7)
      }
      url += `?start=${start.toISOString()}&end=${now.toISOString()}`
    }

    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error('Failed to fetch analytics')
      const json = await res.json()
      setData(json)
    } catch (err: any) {
      alert(`Error: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [filter])

  const handleUnlock = async (taskId: string) => {
    setUnlocking(taskId)
    try {
      const res = await fetch('/api/admin/tasks/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId })
      })
      if (!res.ok) throw new Error('Failed to unlock')
      alert(`Unlocked ${taskId}`)
      fetchData()
    } catch (err: any) {
      alert(`Error: ${err.message}`)
    } finally {
      setUnlocking(null)
    }
  }

  const handleUnlockAll = async () => {
    if (!data?.activeLocks?.length) return
    if (!confirm('Are you sure you want to forcefully unlock ALL tasks? Users currently working on them might lose unsaved progress.')) return
    
    for (const lock of data.activeLocks) {
      await handleUnlock(lock.task_id)
    }
  }

  if (loading && !data) {
    return <div className="flex items-center justify-center p-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
  }

  const { funnel = {}, totalTasks = 0, productivity = [], quality = {}, activeLocks = [] } = data || {}

  const getPercent = (count: number) => {
    if (!totalTasks) return '0%'
    return ((count / totalTasks) * 100).toFixed(1) + '%'
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex items-center gap-2">
        <Calendar className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium mr-2">Time Range:</span>
        <Button variant={filter === 'ALL_TIME' ? 'default' : 'outline'} size="sm" onClick={() => setFilter('ALL_TIME')}>All Time</Button>
        <Button variant={filter === 'TODAY' ? 'default' : 'outline'} size="sm" onClick={() => setFilter('TODAY')}>Today</Button>
        <Button variant={filter === 'LAST_7_DAYS' ? 'default' : 'outline'} size="sm" onClick={() => setFilter('LAST_7_DAYS')}>Last 7 Days</Button>
      </div>

      {loading && <div className="text-xs text-muted-foreground animate-pulse">Refreshing data...</div>}

      {/* Task Funnel */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Imported / Ready</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{funnel.IMPORTED || 0 + funnel.READY_FOR_LABELING || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">Awaiting labeling</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Labeled</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{funnel.LABELED || 0 + funnel.READY_FOR_REVIEW || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">{getPercent(funnel.LABELED || 0 + funnel.READY_FOR_REVIEW || 0)} of total</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-destructive">Needs Correction</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{funnel.NEEDS_CORRECTION || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">{quality?.tasks?.rejectionRate?.toFixed(1) || 0}% rejection rate</p>
          </CardContent>
        </Card>
        <Card className="border-emerald-200 bg-emerald-50/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-emerald-700">Final / Synced</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-700">{funnel.FINAL_APPROVED || 0 + funnel.SYNCED_TO_LABEL_STUDIO || 0}</div>
            <p className="text-xs text-emerald-600/80 mt-1">{getPercent(funnel.FINAL_APPROVED || 0 + funnel.SYNCED_TO_LABEL_STUDIO || 0)} completion</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Productivity Table */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              <CardTitle className="text-lg">User Productivity</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-auto max-h-[400px]">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-muted-foreground uppercase bg-muted/50 sticky top-0">
                  <tr>
                    <th className="px-4 py-3">User</th>
                    <th className="px-4 py-3">Tasks Labeled</th>
                    <th className="px-4 py-3">Tasks Reviewed</th>
                  </tr>
                </thead>
                <tbody>
                  {productivity.length === 0 ? (
                    <tr><td colSpan={3} className="text-center py-4 text-muted-foreground">No activity in this period</td></tr>
                  ) : productivity.map((user: any) => (
                    <tr key={user.email} className="border-b last:border-0">
                      <td className="px-4 py-3 font-medium">{user.email}</td>
                      <td className="px-4 py-3">{user.labelerTasks}</td>
                      <td className="px-4 py-3">{user.reviewerTasks}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Active Locks Table */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Unlock className="h-5 w-5" />
                <CardTitle className="text-lg">Active Task Locks</CardTitle>
              </div>
              {activeLocks.length > 0 && (
                <Button variant="outline" size="sm" onClick={handleUnlockAll} className="text-destructive hover:bg-destructive/10">
                  Force Unlock All
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-auto max-h-[400px]">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-muted-foreground uppercase bg-muted/50 sticky top-0">
                  <tr>
                    <th className="px-4 py-3">Task ID</th>
                    <th className="px-4 py-3">Locked By</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {activeLocks.length === 0 ? (
                    <tr><td colSpan={3} className="text-center py-4 text-muted-foreground">No active locks</td></tr>
                  ) : activeLocks.map((lock: any) => (
                    <tr key={lock.task_id} className="border-b last:border-0">
                      <td className="px-4 py-3 font-mono text-xs">{lock.task_id.slice(0, 12)}...</td>
                      <td className="px-4 py-3">{lock.locked_by}</td>
                      <td className="px-4 py-3 text-right">
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={() => handleUnlock(lock.task_id)}
                          disabled={unlocking === lock.task_id}
                          className="h-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                        >
                          {unlocking === lock.task_id ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Unlock'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
