'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Loader2, Wrench, X, AlertCircle } from 'lucide-react'

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
// ClaimCorrectionButton
// ---------------------------------------------------------------------------

/**
 * Sends POST /api/tasks/claim-correction and redirects to the correction workspace.
 */
export function ClaimCorrectionButton({ taskId }: { taskId: string }) {
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
      const { ok, status, data } = await postJson('/api/tasks/claim-correction', { task_id: taskId })
      if (ok) {
        success = true
        startTransition(() => {
          router.push(`/labeler/correction/${taskId}`)
        })
      } else if (status === 422) {
        setError(data.error ?? 'Cannot claim right now. Do you have another active task?')
        router.refresh()
      } else {
        setError(data.error ?? 'Failed to claim task for correction.')
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
        id={`claim-correction-btn-${taskId}`}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Wrench className="h-4 w-4" />
        )}
        {loading ? 'Starting…' : 'Fix Corrections'}
      </Button>
    </div>
  )
}
