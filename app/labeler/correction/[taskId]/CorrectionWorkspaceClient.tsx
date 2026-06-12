'use client'

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  ChevronLeft,
  ChevronRight,
  Send,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Eye,
  EyeOff,
  AlertTriangle,
} from 'lucide-react'
import type { Task } from '@/types/task'
import type { Label as LabelType } from '@/types/label'
import type { Review } from '@/types/review'
import type { RegionWithCrop } from '@/app/labeler/task/[taskId]/page'

interface RegionInput {
  text: string
  isUnreadable: boolean
  saved: boolean
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'
type SubmitStatus = 'idle' | 'submitting' | 'success' | 'error'

interface Props {
  task: Task
  allRegions: RegionWithCrop[]
  labelMap: Record<string, LabelType>
  reviewMap: Record<string, Review>
  proxiedImageUrl: string
}

const SCRIPT_TAG_COLORS: Record<string, string> = {
  KAITHI: 'bg-amber-100 text-amber-800 border-amber-300',
  DEVANAGARI: 'bg-orange-100 text-orange-800 border-orange-300',
  ENGLISH: 'bg-blue-100 text-blue-800 border-blue-300',
  OTHER: 'bg-gray-100 text-gray-700 border-gray-300',
}

function scriptTagClass(tag: string): string {
  return SCRIPT_TAG_COLORS[tag?.toUpperCase()] ?? SCRIPT_TAG_COLORS.OTHER
}

export function CorrectionWorkspaceClient({ task, allRegions, labelMap, reviewMap, proxiedImageUrl }: Props) {
  const router = useRouter()

  // Only these regions are interactive in this workspace
  const correctionRegions = useMemo(() => {
    return allRegions.filter(r => r.status === 'NEEDS_CORRECTION' || r.status === 'CORRECTED')
  }, [allRegions])

  const [currentIndex, setCurrentIndex] = useState(0)
  const [inputs, setInputs] = useState<Record<string, RegionInput>>(() => {
    const init: Record<string, RegionInput> = {}
    for (const r of correctionRegions) {
      const existing = labelMap[r.region_id]
      init[r.region_id] = {
        text: existing?.text ?? '',
        isUnreadable: existing?.is_unreadable ?? false,
        saved: r.status === 'CORRECTED', // Pre-mark saved if they already saved it
      }
    }
    return init
  })

  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [saveError, setSaveError] = useState('')
  const [submitStatus, setSubmitStatus] = useState<SubmitStatus>('idle')
  const [submitError, setSubmitError] = useState('')
  const [showFullPage, setShowFullPage] = useState(true)

  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const region = correctionRegions[currentIndex]
  const input = region ? (inputs[region.region_id] ?? { text: '', isUnreadable: false, saved: false }) : null
  const review = region ? reviewMap[region.region_id] : null

  const savedCount = correctionRegions.filter((r) => inputs[r.region_id]?.saved).length
  const progressPercent = correctionRegions.length ? Math.round((savedCount / correctionRegions.length) * 100) : 0
  const allDone = savedCount === correctionRegions.length && correctionRegions.length > 0

  // ── Lock refresh heartbeat ───────────────────────────────────────────────

  useEffect(() => {
    const INTERVAL_MS = 3 * 60 * 1000
    const refreshLock = async () => {
      try {
        await fetch('/api/tasks/refresh-lock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ task_id: task.task_id }),
        })
      } catch {}
    }
    const timer = setInterval(refreshLock, INTERVAL_MS)
    return () => clearInterval(timer)
  }, [task.task_id])

  useEffect(() => {
    if (!input?.isUnreadable) {
      setTimeout(() => textareaRef.current?.focus(), 50)
    }
  }, [currentIndex, input?.isUnreadable])

  // ── Handlers ─────────────────────────────────────────────────────────────

  const updateInput = useCallback((regionId: string, patch: Partial<RegionInput>) => {
    setInputs((prev) => ({ ...prev, [regionId]: { ...prev[regionId], ...patch } }))
  }, [])

  const handleSave = useCallback(async (andGoNext = true) => {
    if (!region) return
    const cur = inputs[region.region_id] ?? { text: '', isUnreadable: false, saved: false }

    setSaveStatus('saving')
    setSaveError('')

    try {
      const res = await fetch('/api/regions/save-label', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task_id: task.task_id,
          region_id: region.region_id,
          text: cur.text,
          is_unreadable: cur.isUnreadable,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? `Server error ${res.status}`)
      }

      updateInput(region.region_id, { saved: true })
      setSaveStatus('saved')

      if (andGoNext && currentIndex < correctionRegions.length - 1) {
        setCurrentIndex((i) => i + 1)
        setSaveStatus('idle')
      }
    } catch (err) {
      setSaveStatus('error')
      setSaveError(err instanceof Error ? err.message : 'Save failed')
    }
  }, [region, inputs, task.task_id, currentIndex, correctionRegions.length, updateInput])

  const handleSubmit = useCallback(async () => {
    setSubmitStatus('submitting')
    setSubmitError('')

    try {
      const res = await fetch('/api/tasks/submit-correction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: task.task_id }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? `Server error ${res.status}`)
      }

      setSubmitStatus('success')
      setTimeout(() => router.push('/labeler'), 1200)
    } catch (err) {
      setSubmitStatus('error')
      setSubmitError(err instanceof Error ? err.message : 'Submit failed')
    }
  }, [task.task_id, router])

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'TEXTAREA' || tag === 'INPUT') return

      if (e.key === 'ArrowRight' && currentIndex < correctionRegions.length - 1) setCurrentIndex((i) => i + 1)
      if (e.key === 'ArrowLeft' && currentIndex > 0) setCurrentIndex((i) => i - 1)
      if (e.key === 'u' || e.key === 'U') {
        if (region) updateInput(region.region_id, { isUnreadable: !input?.isUnreadable })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [currentIndex, correctionRegions.length, region, input?.isUnreadable, updateInput])

  if (correctionRegions.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-4">
        <CheckCircle2 className="h-10 w-10 text-emerald-500" />
        <p>No corrections needed! All rejected regions have been corrected.</p>
        <Button onClick={handleSubmit} disabled={submitStatus !== 'idle'} className="mt-4">
          {submitStatus !== 'idle' ? 'Submitting…' : 'Submit Task back to Reviewer'}
        </Button>
      </div>
    )
  }

  // ── Crop CSS ─────────────────────────────────────────────────────────────
  const MAX_DISPLAY = 280
  const MAX_SCALE   = 2.0
  const cropW = region.cropWidth  || 1
  const cropH = region.cropHeight || 1
  const scale = Math.min(MAX_DISPLAY / cropW, MAX_DISPLAY / cropH, MAX_SCALE)
  const displayW = Math.round(cropW * scale)
  const displayH = Math.round(cropH * scale)
  const centerX = (region.cropXmin + cropW / 2) * scale
  const centerY = (region.cropYmin + cropH / 2) * scale

  return (
    <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">

      {/* ── LEFT: Full page image panel ────────────────────────────────── */}
      <div
        className={`lg:w-1/2 xl:w-3/5 border-r bg-muted/30 overflow-auto flex flex-col ${
          showFullPage ? '' : 'hidden lg:flex'
        }`}
      >
        <div className="flex items-center justify-between px-4 py-2 border-b bg-card shrink-0">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Full Page
          </span>
          <button
            onClick={() => setShowFullPage((v) => !v)}
            className="lg:hidden text-muted-foreground hover:text-foreground"
            aria-label="Toggle full page"
          >
            {showFullPage ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>

        <div className="flex-1 overflow-auto p-2">
          {proxiedImageUrl ? (
            <div className="relative inline-block w-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={proxiedImageUrl} alt="Full page" className="w-full h-auto block" loading="eager" />

              {/* Bbox highlights for all regions */}
              {allRegions.map((r, i) => {
                const isCurrentCorrection = r.region_id === region.region_id
                const isCorrectionTarget = correctionRegions.some(cr => cr.region_id === r.region_id)
                
                return (
                  <div
                    key={r.region_id}
                    title={isCorrectionTarget ? `Needs Correction (Region ${i + 1})` : `Region ${i + 1}`}
                    style={{
                      position: 'absolute',
                      left: `${r.bbox_x_percent}%`,
                      top: `${r.bbox_y_percent}%`,
                      width: `${r.bbox_width_percent}%`,
                      height: `${r.bbox_height_percent}%`,
                      transform: r.rotation ? `rotate(${r.rotation}deg)` : undefined,
                      transformOrigin: 'center',
                      border: isCurrentCorrection
                        ? '3px solid #ef4444' // Red for active correction
                        : isCorrectionTarget 
                          ? '2px solid #f59e0b' // Orange for pending corrections
                          : '1px solid rgba(99,102,241,0.3)', // Dimmed for approved/others
                      background: isCurrentCorrection
                        ? 'rgba(239,68,68,0.18)'
                        : isCorrectionTarget
                          ? 'rgba(245,158,11,0.1)'
                          : 'rgba(99,102,241,0.05)',
                      transition: 'border-color 0.15s, background 0.15s',
                    }}
                  >
                    <span
                      style={{
                        position: 'absolute',
                        top: -1,
                        left: -1,
                        fontSize: '9px',
                        lineHeight: 1,
                        padding: '1px 3px',
                        background: isCurrentCorrection ? '#ef4444' : isCorrectionTarget ? '#f59e0b' : 'rgba(99,102,241,0.5)',
                        color: '#fff',
                        borderRadius: '0 0 2px 0',
                        pointerEvents: 'none',
                      }}
                    >
                      {i + 1}
                    </span>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="flex h-48 items-center justify-center text-muted-foreground text-sm">
              No image available
            </div>
          )}
        </div>
      </div>

      {/* ── RIGHT: Labeling panel ───────────────────────────────────────── */}
      <div className="lg:w-1/2 xl:w-2/5 flex flex-col overflow-hidden">

        {/* Progress header */}
        <div className="px-5 py-3 border-b bg-card shrink-0 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-destructive">
              Correction {currentIndex + 1} <span className="text-muted-foreground">of {correctionRegions.length}</span>
            </span>
            <span className="text-muted-foreground text-xs">{savedCount}/{correctionRegions.length} corrected</span>
          </div>
          <Progress value={progressPercent} className="h-1.5 [&>div]:bg-destructive" />
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-5 space-y-5">

            {/* Reviewer Note */}
            {review && review.review_note && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold text-destructive uppercase tracking-wide mb-1">
                      Reviewer Note
                    </p>
                    <p className="text-sm text-destructive/90 break-words">
                      {review.review_note}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Crop preview */}
            <div>
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                Crop Preview
                {region.rotation !== 0 && (
                  <span className="ml-2 text-amber-600">↺ {region.rotation}°</span>
                )}
              </div>
              <div
                className="relative overflow-hidden rounded-lg border bg-muted/40"
                style={{ width: displayW, height: displayH }}
              >
                {proxiedImageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={proxiedImageUrl}
                    alt={`Crop of correction ${currentIndex + 1}`}
                    style={{
                      position: 'absolute',
                      width: task.original_width * scale,
                      height: task.original_height * scale,
                      left: -region.cropXmin * scale,
                      top: -region.cropYmin * scale,
                      transform: region.rotation ? `rotate(${region.rotation}deg)` : undefined,
                      transformOrigin: `${centerX}px ${centerY}px`,
                      maxWidth: 'none',
                    }}
                  />
                )}
              </div>
            </div>

            {/* Script tag */}
            <div>
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
                Script Tag <span className="text-[10px] normal-case">(readonly)</span>
              </div>
              <span
                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${scriptTagClass(region.script_tag_final)}`}
              >
                {region.script_tag_final || region.script_tag_original || 'UNKNOWN'}
              </span>
            </div>

            {/* Text input */}
            <div>
              <Label htmlFor="region-text" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Transcription
              </Label>
              <Textarea
                id="region-text"
                ref={textareaRef}
                value={input?.text ?? ''}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
                  if (input?.isUnreadable) return
                  updateInput(region.region_id, { text: e.target.value, saved: false })
                }}
                disabled={input?.isUnreadable}
                placeholder={input?.isUnreadable ? '(marked unreadable)' : 'Correct the transcription here…'}
                className="mt-1.5 min-h-[80px] font-mono text-sm resize-none focus-visible:ring-destructive"
                onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault()
                    handleSave(true)
                  }
                }}
              />
            </div>

            {/* Unreadable toggle */}
            <div className="flex items-center gap-2.5">
              <Checkbox
                id="unreadable"
                checked={input?.isUnreadable ?? false}
                onCheckedChange={(checked: boolean | 'indeterminate') => {
                  updateInput(region.region_id, {
                    isUnreadable: checked === true,
                    text: checked === true ? '' : (input?.text ?? ''),
                    saved: false,
                  })
                }}
              />
              <label htmlFor="unreadable" className="text-sm cursor-pointer select-none">
                Mark as unreadable <kbd className="ml-1 text-[10px] px-1 py-0.5 rounded border bg-muted">U</kbd>
              </label>
            </div>

            {/* Save status */}
            {saveStatus === 'error' && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {saveError}
              </div>
            )}
            {saveStatus === 'saved' && !input?.saved && (
              <div className="flex items-center gap-2 text-sm text-emerald-600">
                <CheckCircle2 className="h-4 w-4" />
                Saved Correction
              </div>
            )}

          </div>
        </div>

        {/* ── Navigation & Submit footer ──────────────────────────────── */}
        <div className="border-t bg-card px-5 py-4 shrink-0 space-y-3">

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={currentIndex === 0}
              onClick={() => setCurrentIndex((i) => i - 1)}
              className="gap-1"
            >
              <ChevronLeft className="h-4 w-4" />
              Prev
            </Button>

            <Button
              variant="default"
              size="sm"
              disabled={saveStatus === 'saving'}
              onClick={() => handleSave(true)}
              className="flex-1 gap-1"
            >
              {saveStatus === 'saving' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              {currentIndex < correctionRegions.length - 1 ? 'Save & Next' : 'Save'}
            </Button>
          </div>

          <Button
            variant={allDone ? 'default' : 'outline'}
            size="sm"
            className={`w-full gap-2 ${allDone ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : ''}`}
            disabled={!allDone || submitStatus === 'submitting' || submitStatus === 'success'}
            onClick={handleSubmit}
            title={allDone ? 'Submit corrections back for review' : `${correctionRegions.length - savedCount} region(s) still need correction`}
          >
            {submitStatus === 'submitting' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : submitStatus === 'success' ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            {submitStatus === 'success'
              ? 'Submitted! Redirecting…'
              : `Submit Corrections (${savedCount}/${correctionRegions.length})`}
          </Button>

          {submitError && (
            <p className="text-xs text-destructive text-center">{submitError}</p>
          )}

          <button
            onClick={() => setShowFullPage((v) => !v)}
            className="lg:hidden w-full text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            {showFullPage ? 'Hide full page' : 'Show full page'}
          </button>
        </div>

        {/* ── Region list sidebar (scrollable overview) ───────────────── */}
        <div className="border-t max-h-36 overflow-y-auto px-4 py-2 bg-muted/20 shrink-0">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5 font-medium">
            Corrections Queue
          </p>
          <div className="flex flex-wrap gap-1">
            {correctionRegions.map((r, i) => {
              const inp = inputs[r.region_id]
              const isCurrent = i === currentIndex
              const isSaved = inp?.saved
              // To find the original index:
              const originalIndex = allRegions.findIndex(ar => ar.region_id === r.region_id) + 1
              
              return (
                <button
                  key={r.region_id}
                  onClick={() => setCurrentIndex(i)}
                  className={`
                    w-7 h-7 rounded text-[11px] font-semibold transition-colors
                    ${isCurrent
                      ? 'bg-destructive text-destructive-foreground ring-2 ring-destructive/50'
                      : isSaved
                        ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                        : 'bg-muted text-muted-foreground hover:bg-muted/80'}
                  `}
                  title={`Region ${originalIndex}${isSaved ? ' (saved)' : ''}`}
                >
                  {originalIndex}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
