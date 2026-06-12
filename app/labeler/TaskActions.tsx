'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Loader2, Play, X, AlertCircle } from 'lucide-react'

// ---------------------------------------------------------------------------
// Shared internal fetch helper
// ---------------------------------------------------------------------------

async function postJson(url: string, body: Record<string, string>) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data }
}

// ---------------------------------------------------------------------------
// Inline error message (self-contained)
// ---------------------------------------------------------------------------

function InlineError({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
    >
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span className="flex-1">{message}</span>
      <button onClick={onDismiss} aria-label="Dismiss" className="opacity-60 hover:opacity-100">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ClaimButton
// ---------------------------------------------------------------------------

/**
 * Sends POST /api/tasks/claim and redirects to the task workspace on success.
 * Manages its own error state — no wrapper or callback needed.
 * Safe to use directly from RSC pages.
 */
export function ClaimButton({ taskId }: { taskId: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [localLoading, setLocalLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loading = isPending || localLoading

  async function handleClaim() {
    setError(null)
    setLocalLoading(true)
    let success = false
    try {
      const { ok, status, data } = await postJson('/api/tasks/claim', { task_id: taskId })
      if (ok) {
        success = true
        startTransition(() => {
          router.push(`/labeler/task/${taskId}`)
        })
      } else if (status === 409 && data.existingTaskId) {
        setError(
          `You already have an active task (${data.existingTaskId}). Complete or release it before claiming another.`
        )
        router.refresh()
      } else if (status === 409) {
        setError('This task is no longer available.')
        router.refresh()
      } else {
        setError(data.error ?? 'Failed to claim task.')
      }
    } catch {
      setError('Network error — please try again.')
    } finally {
      if (!success) {
        setLocalLoading(false)
      }
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {error && <InlineError message={error} onDismiss={() => setError(null)} />}
      <Button
        size="sm"
        onClick={handleClaim}
        disabled={loading}
        className="w-full gap-2"
        id={`claim-btn-${taskId}`}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Play className="h-4 w-4" />
        )}
        {loading ? 'Claiming…' : 'Claim Task'}
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ReleaseButton
// ---------------------------------------------------------------------------

/**
 * Sends POST /api/tasks/release then refreshes the dashboard.
 * Manages its own error state — no wrapper or callback needed.
 * Safe to use directly from RSC pages.
 */
export function ReleaseButton({ taskId }: { taskId: string }) {
  const router = useRouter()
  const [localLoading, setLocalLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleRelease() {
    if (
      !confirm(
        'Release this task? Your progress will be saved but the task will return to the available pool.'
      )
    )
      return
    setError(null)
    setLocalLoading(true)
    try {
      const { ok, data } = await postJson('/api/tasks/release', { task_id: taskId })
      if (ok) {
        router.refresh()
      } else {
        setError(data.error ?? 'Failed to release task.')
      }
    } catch {
      setError('Network error — please try again.')
    } finally {
      setLocalLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {error && <InlineError message={error} onDismiss={() => setError(null)} />}
      <Button
        size="sm"
        variant="outline"
        onClick={handleRelease}
        disabled={localLoading}
        className="gap-2 text-destructive border-destructive/40 hover:bg-destructive/10"
        id={`release-btn-${taskId}`}
      >
        {localLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <X className="h-4 w-4" />
        )}
        {localLoading ? 'Releasing…' : 'Release Task'}
      </Button>
    </div>
  )
}
