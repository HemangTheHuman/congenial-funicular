'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
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
  ZoomIn,
  ZoomOut,
  Sun,
  Moon,
} from 'lucide-react'
import type { Task } from '@/types/task'
import type { Label as LabelType } from '@/types/label'
import type { RegionWithCrop } from './page'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RegionInput {
  text: string
  isUnreadable: boolean
  /** Whether this input has been server-confirmed (LABELED/UNREADABLE in Sheet) */
  saved: boolean
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'
type SubmitStatus = 'idle' | 'submitting' | 'success' | 'error'

interface Props {
  task: Task
  regions: RegionWithCrop[]
  labelMap: Record<string, LabelType>
  proxiedImageUrl: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SCRIPT_TAG_COLORS: Record<string, string> = {
  KAITHI: 'bg-amber-100 text-amber-800 border-amber-300',
  DEVANAGARI: 'bg-orange-100 text-orange-800 border-orange-300',
  ENGLISH: 'bg-blue-100 text-blue-800 border-blue-300',
  OTHER: 'bg-gray-100 text-gray-700 border-gray-300',
}

function scriptTagClass(tag: string): string {
  return SCRIPT_TAG_COLORS[tag?.toUpperCase()] ?? SCRIPT_TAG_COLORS.OTHER
}

// ---------------------------------------------------------------------------
// WorkspaceClient
// ---------------------------------------------------------------------------

export function WorkspaceClient({ task, regions, labelMap, proxiedImageUrl }: Props) {
  const router = useRouter()

  // ── State ────────────────────────────────────────────────────────────────

  const [currentIndex, setCurrentIndex] = useState(0)
  const [inputs, setInputs] = useState<Record<string, RegionInput>>(() => {
    // Pre-populate from existing server labels
    const init: Record<string, RegionInput> = {}
    for (const r of regions) {
      const existing = labelMap[r.region_id]
      init[r.region_id] = {
        text: existing?.text ?? '',
        isUnreadable: existing?.is_unreadable ?? false,
        saved: existing != null, // has a server-confirmed label
      }
    }
    return init
  })

  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [saveError, setSaveError] = useState('')
  const [submitStatus, setSubmitStatus] = useState<SubmitStatus>('idle')
  const [submitError, setSubmitError] = useState('')
  const [showFullPage, setShowFullPage] = useState(true)

  // Phase 13 image manipulation
  const [imgBrightness, setImgBrightness] = useState(100)
  const [imgContrast, setImgContrast] = useState(100)
  const [imgInvert, setImgInvert] = useState(false)
  const [fullPageZoom, setFullPageZoom] = useState(100)

  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // ── Derived ──────────────────────────────────────────────────────────────

  const region = regions[currentIndex]
  const input = region ? (inputs[region.region_id] ?? { text: '', isUnreadable: false, saved: false }) : null

  const savedCount = regions.filter((r) => inputs[r.region_id]?.saved).length
  const progressPercent = regions.length ? Math.round((savedCount / regions.length) * 100) : 0
  const allDone = savedCount === regions.length && regions.length > 0

  // ── Lock refresh heartbeat ───────────────────────────────────────────────

  useEffect(() => {
    const INTERVAL_MS = 3 * 60 * 1000 // 3 minutes

    const refreshLock = async () => {
      try {
        await fetch('/api/tasks/refresh-lock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ task_id: task.task_id }),
        })
      } catch {
        // Silently ignore — lock will expire naturally
      }
    }

    const timer = setInterval(refreshLock, INTERVAL_MS)
    return () => clearInterval(timer)
  }, [task.task_id])

  // ── beforeunload guard — warn if any label is unsaved ───────────────────

  useEffect(() => {
    const hasUnsaved = Object.values(inputs).some((inp) => !inp.saved)
    if (!hasUnsaved) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [inputs])

  // ── Focus textarea when region changes ───────────────────────────────────

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
        throw new Error((data as { error?: string }).error ?? `Server error ${res.status}`)
      }

      // Mark as saved in local state
      updateInput(region.region_id, { saved: true })
      setSaveStatus('saved')

      // Auto-advance to next region
      if (andGoNext && currentIndex < regions.length - 1) {
        setCurrentIndex((i) => i + 1)
        setSaveStatus('idle')
      }
    } catch (err) {
      setSaveStatus('error')
      setSaveError(err instanceof Error ? err.message : 'Save failed')
    }
  }, [region, inputs, task.task_id, currentIndex, regions.length, updateInput])

  const handleSubmit = useCallback(async () => {
    // UX-3: Prevent double-submit
    if (submitStatus === 'submitting') return
    setSubmitStatus('submitting')
    setSubmitError('')

    try {
      const res = await fetch('/api/tasks/submit-labeling', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: task.task_id }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { error?: string }).error ?? `Server error ${res.status}`)
      }

      setSubmitStatus('success')
      setTimeout(() => router.push('/labeler'), 1200)
    } catch (err) {
      setSubmitStatus('submitting')
      setSubmitError(err instanceof Error ? err.message : 'Submit failed')
      setSubmitStatus('error')
    }
  }, [task.task_id, router])

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'TEXTAREA' || tag === 'INPUT') return

      if (e.key === 'ArrowRight' && currentIndex < regions.length - 1) {
        setCurrentIndex((i) => i + 1)
      }
      if (e.key === 'ArrowLeft' && currentIndex > 0) {
        setCurrentIndex((i) => i - 1)
      }
      if (e.key === 'u' || e.key === 'U') {
        if (region) updateInput(region.region_id, { isUnreadable: !input?.isUnreadable })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [currentIndex, regions.length, region, input?.isUnreadable, updateInput])

  // ── Early returns ────────────────────────────────────────────────────────

  if (regions.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        No regions found for this task.
      </div>
    )
  }

  // ── Crop CSS (no canvas) ─────────────────────────────────────────────────
  // Scale the crop to fit within MAX_DISPLAY × MAX_DISPLAY, but never upscale
  // more than MAX_SCALE× — avoids tiny bboxes being blown up into a pixelated mess.

  const MAX_DISPLAY = 280  // max container dimension (px)
  const MAX_SCALE   = 2.0  // never upscale more than 2×
  const cropW = region.cropWidth  || 1
  const cropH = region.cropHeight || 1
  const scale = Math.min(MAX_DISPLAY / cropW, MAX_DISPLAY / cropH, MAX_SCALE)
  const displayW = Math.round(cropW * scale)
  const displayH = Math.round(cropH * scale)

  // transform-origin: top-left of the bbox in image pixel space (scaled)
  const originX = region.cropXmin * scale
  const originY = region.cropYmin * scale

  // ── Render ───────────────────────────────────────────────────────────────

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
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setFullPageZoom(z => Math.max(20, z - 20))} title="Zoom Out">
              <ZoomOut className="h-3 w-3" />
            </Button>
            <span className="text-[10px] tabular-nums w-8 text-center">{fullPageZoom}%</span>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setFullPageZoom(z => Math.min(500, z + 20))} title="Zoom In">
              <ZoomIn className="h-3 w-3" />
            </Button>
            <div className="w-px h-3 bg-border mx-1" />
            <button
              onClick={() => setShowFullPage((v) => !v)}
              className="lg:hidden text-muted-foreground hover:text-foreground"
              aria-label="Toggle full page"
            >
              {showFullPage ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-2">
          {proxiedImageUrl ? (
            <div className="relative inline-block" style={{ width: `${fullPageZoom}%`, minWidth: '100%', transition: 'width 0.2s ease' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={proxiedImageUrl}
                alt="Full page"
                className="w-full h-auto block"
                loading="eager"
              />

              {/* Bbox highlight only for active region */}
              {region && (
                <div
                  title="Current Region"
                  style={{
                    position: 'absolute',
                    left: `${region.bbox_x_percent}%`,
                    top: `${region.bbox_y_percent}%`,
                    width: `${region.bbox_width_percent}%`,
                    height: `${region.bbox_height_percent}%`,
                    transform: region.rotation ? `rotate(${region.rotation}deg)` : undefined,
                    transformOrigin: 'top left',
                    pointerEvents: 'none',
                    border: '2px solid #f59e0b',
                    background: 'rgba(245,158,11,0.18)',
                  }}
                />
              )}
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
            <span className="font-medium">
              Region {currentIndex + 1} <span className="text-muted-foreground">of {regions.length}</span>
            </span>
            <span className="text-muted-foreground text-xs">{savedCount}/{regions.length} saved</span>
          </div>
          <Progress value={progressPercent} className="h-1.5" />
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-5 space-y-5">

            {/* Crop preview */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Crop Preview
                  {region.rotation !== 0 && (
                    <span className="ml-2 text-amber-600">↺ {region.rotation}°</span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setImgBrightness(b => Math.max(50, b - 20))} title="Decrease Brightness"><Moon className="h-3 w-3" /></Button>
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setImgBrightness(b => Math.min(200, b + 20))} title="Increase Brightness"><Sun className="h-3 w-3" /></Button>
                  <div className="w-px h-3 bg-border mx-1" />
                  <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={() => setImgContrast(c => c === 100 ? 150 : (c === 150 ? 200 : 100))} title="Toggle High Contrast">Contrast</Button>
                  <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={() => setImgInvert(i => !i)} title="Invert Colors">Invert</Button>
                  {(imgBrightness !== 100 || imgContrast !== 100 || imgInvert) && (
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] text-muted-foreground ml-1" onClick={() => { setImgBrightness(100); setImgContrast(100); setImgInvert(false); }}>Reset</Button>
                  )}
                </div>
              </div>
              <div
                className="relative overflow-hidden rounded-lg border bg-muted/40"
                style={{ width: displayW, height: displayH }}
              >
                {proxiedImageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={proxiedImageUrl}
                    alt={`Crop of region ${currentIndex + 1}`}
                    style={{
                      position: 'absolute',
                      width: task.original_width * scale,
                      height: task.original_height * scale,
                      left: -region.cropXmin * scale,
                      top: -region.cropYmin * scale,
                      transform: region.rotation ? `rotate(${-region.rotation}deg)` : undefined,
                      transformOrigin: `${originX}px ${originY}px`,
                      maxWidth: 'none',
                      filter: `brightness(${imgBrightness}%) contrast(${imgContrast}%) ${imgInvert ? 'invert(100%)' : ''}`,
                      transition: 'filter 0.2s ease',
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
                placeholder={input?.isUnreadable ? '(marked unreadable)' : 'Type the transcription here…'}
                className="mt-1.5 min-h-[80px] font-mono text-sm resize-none"
                onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
                  // Ctrl+Enter = Save & Next
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
                Saved
              </div>
            )}

          </div>
        </div>

        {/* ── Navigation & Submit footer ──────────────────────────────── */}
        <div className="border-t bg-card px-5 py-4 shrink-0 space-y-3">

          {/* Nav row */}
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
              {currentIndex < regions.length - 1 ? 'Save & Next' : 'Save'}
            </Button>
          </div>

          {/* Submit row */}
          <Button
            variant={allDone ? 'default' : 'outline'}
            size="sm"
            className={`w-full gap-2 ${allDone ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : ''}`}
            disabled={!allDone || submitStatus === 'submitting' || submitStatus === 'success'}
            onClick={handleSubmit}
            title={allDone ? 'Submit task for review' : `${regions.length - savedCount} region(s) still need labels`}
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
              : `Submit for Review (${savedCount}/${regions.length})`}
          </Button>

          {submitError && (
            <p className="text-xs text-destructive text-center">{submitError}</p>
          )}

          {/* Mobile: toggle full page button */}
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
            All Regions
          </p>
          <div className="flex flex-wrap gap-1">
            {regions.map((r, i) => {
              const inp = inputs[r.region_id]
              const isCurrent = i === currentIndex
              const isSaved = inp?.saved
              return (
                <button
                  key={r.region_id}
                  onClick={() => setCurrentIndex(i)}
                  className={`
                    w-7 h-7 rounded text-[11px] font-semibold transition-colors
                    ${isCurrent
                      ? 'bg-primary text-primary-foreground ring-2 ring-primary/50'
                      : isSaved
                        ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                        : 'bg-muted text-muted-foreground hover:bg-muted/80'}
                  `}
                  title={`Region ${i + 1}${isSaved ? ' (saved)' : ''}`}
                >
                  {i + 1}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
