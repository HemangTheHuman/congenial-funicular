'use client'

import { useState, useCallback } from 'react'
import { AlertCircle, X } from 'lucide-react'

/**
 * Lightweight inline error banner used by the labeler dashboard.
 * Wraps child components that need to surface errors without a full toast library.
 *
 * Usage:
 *   <ErrorBanner>
 *     {(showError) => <ClaimButton onError={showError} ... />}
 *   </ErrorBanner>
 */
export function ErrorBanner({
  children,
}: {
  children: (showError: (msg: string) => void) => React.ReactNode
}) {
  const [error, setError] = useState<string | null>(null)
  const showError = useCallback((msg: string) => setError(msg), [])

  return (
    <>
      {error && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1">{error}</span>
          <button
            onClick={() => setError(null)}
            aria-label="Dismiss error"
            className="ml-auto opacity-60 hover:opacity-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {children(showError)}
    </>
  )
}
