'use client'

import { useState, useTransition, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Loader2, CheckSquare, X } from 'lucide-react'

// ---------------------------------------------------------------------------
// ReviewClaimButton
// ---------------------------------------------------------------------------

export function ReviewClaimButton({ taskId }: { taskId: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [localLoading, setLocalLoading] = useState(false)
  const [error, setError] = useState('')

  const loading = isPending || localLoading

  const handleClaim = useCallback(async () => {
    setError('')
    setLocalLoading(true)
    let success = false
    try {
      const res = await fetch('/api/review/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: taskId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? `Error ${res.status}`)
        return
      }
      success = true
      startTransition(() => router.push(`/reviewer/task/${taskId}`))
    } catch {
      setError('Network error. Please try again.')
    } finally {
      if (!success) {
        setLocalLoading(false)
      }
    }
  }, [taskId, router])

  return (
    <div className="space-y-1.5">
      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}
      <Button
        id={`claim-review-${taskId}`}
        size="sm"
        className="w-full gap-1"
        disabled={loading}
        onClick={handleClaim}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <CheckSquare className="h-4 w-4" />
        )}
        {loading ? 'Claiming…' : 'Start Review'}
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ReviewReleaseButton
// ---------------------------------------------------------------------------

export function ReviewReleaseButton({ taskId }: { taskId: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  const handleRelease = useCallback(async () => {
    if (!confirm('Release this task? It will return to the review queue.')) return
    setError('')
    try {
      const res = await fetch('/api/review/release', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: taskId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? `Error ${res.status}`)
        return
      }
      startTransition(() => router.refresh())
    } catch {
      setError('Network error. Please try again.')
    }
  }, [taskId, router])

  return (
    <div className="space-y-1.5">
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button
        id={`release-review-${taskId}`}
        variant="outline"
        size="sm"
        className="gap-1 text-muted-foreground"
        disabled={isPending}
        onClick={handleRelease}
      >
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <X className="h-4 w-4" />
        )}
        Release
      </Button>
    </div>
  )
}
