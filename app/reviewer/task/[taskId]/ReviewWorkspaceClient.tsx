'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  ChevronLeft,
  ChevronRight,
  Send,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Eye,
  EyeOff,
  ThumbsUp,
  ThumbsDown,
  Type,
  Tag,
} from 'lucide-react'
import type { Task } from '@/types/task'
import type { Label as LabelType } from '@/types/label'
import type { Review } from '@/types/review'
import type { RegionWithCrop } from './page'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCRIPT_TAGS = ['KAITHI', 'DEVANAGARI', 'ENGLISH', 'OTHER']

const SCRIPT_TAG_COLORS: Record<string, string> = {
  KAITHI:     'bg-amber-100 text-amber-800 border-amber-300',
  DEVANAGARI: 'bg-orange-100 text-orange-800 border-orange-300',
  ENGLISH:    'bg-blue-100 text-blue-800 border-blue-300',
  OTHER:      'bg-gray-100 text-gray-700 border-gray-300',
}

function scriptTagClass(tag: string): string {
  return SCRIPT_TAG_COLORS[tag?.toUpperCase()] ?? SCRIPT_TAG_COLORS.OTHER
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ReviewChoice = 'APPROVED' | 'TEXT_WRONG' | 'SCRIPT_WRONG' | 'BOTH_WRONG'

interface RegionDecision {
  choice:          ReviewChoice | null   // null = not yet decided
  scriptTag:       string                // current value (may be changed by reviewer)
  note:            string
  saved:           boolean               // server-confirmed
}

type SaveStatus   = 'idle' | 'saving' | 'saved' | 'error'
type SubmitStatus = 'idle' | 'submitting' | 'success' | 'error'

interface Props {
  task:             Task
  regions:          RegionWithCrop[]
  labelMap:         Record<string, LabelType>
  reviewMap:        Record<string, Review>     // previous round reviews (for re-review context)
  proxiedImageUrl:  string
}

// ---------------------------------------------------------------------------
// ReviewWorkspaceClient
// ---------------------------------------------------------------------------

export function ReviewWorkspaceClient({
  task,
  regions,
  labelMap,
  reviewMap,
  proxiedImageUrl,
}: Props) {
  const router = useRouter()

  // ── State ────────────────────────────────────────────────────────────────

  const [currentIndex, setCurrentIndex] = useState(0)
  const [decisions, setDecisions] = useState<Record<string, RegionDecision>>(() => {
    const init: Record<string, RegionDecision> = {}
    for (const r of regions) {
      init[r.region_id] = {
        choice:    null,
        scriptTag: r.script_tag_final || r.script_tag_original,
        note:      '',
        saved:     false,
      }
    }
    return init
  })

  const [saveStatus,   setSaveStatus]   = useState<SaveStatus>('idle')
  const [saveError,    setSaveError]    = useState('')
  const [submitStatus, setSubmitStatus] = useState<SubmitStatus>('idle')
  const [submitError,  setSubmitError]  = useState('')
  const [showFullPage, setShowFullPage] = useState(true)

  const noteRef = useRef<HTMLTextAreaElement>(null)

  // ── Derived ──────────────────────────────────────────────────────────────

  const region   = regions[currentIndex]
  const decision = region ? (decisions[region.region_id] ?? { choice: null, scriptTag: '', note: '', saved: false }) : null

  const savedCount     = regions.filter((r) => decisions[r.region_id]?.saved).length
  const progressPercent = regions.length ? Math.round((savedCount / regions.length) * 100) : 0
  const allDone         = savedCount === regions.length && regions.length > 0

  const label     = region ? labelMap[region.region_id] : null
  const prevReview = region ? reviewMap[region.region_id] : null

  // ── Lock refresh ─────────────────────────────────────────────────────────

  useEffect(() => {
    const INTERVAL_MS = 3 * 60 * 1000
    const refresh = async () => {
      try {
        await fetch('/api/tasks/refresh-lock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ task_id: task.task_id }),
        })
      } catch { /* silent */ }
    }
    const timer = setInterval(refresh, INTERVAL_MS)
    return () => clearInterval(timer)
  }, [task.task_id])

  // ── Handlers ─────────────────────────────────────────────────────────────

  const updateDecision = useCallback(
    (regionId: string, patch: Partial<RegionDecision>) => {
      setDecisions((prev) => ({ ...prev, [regionId]: { ...prev[regionId], ...patch } }))
    },
    []
  )

  const handleSave = useCallback(async (andGoNext = true) => {
    if (!region || !decision?.choice) return
    setSaveStatus('saving')
    setSaveError('')

    try {
      const res = await fetch('/api/review/region', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task_id:          task.task_id,
          region_id:        region.region_id,
          review_status:    decision.choice,
          final_script_tag: decision.scriptTag,
          review_note:      decision.note,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { error?: string }).error ?? `Server error ${res.status}`)
      }

      updateDecision(region.region_id, { saved: true })
      setSaveStatus('saved')

      if (andGoNext && currentIndex < regions.length - 1) {
        setCurrentIndex((i) => i + 1)
        setSaveStatus('idle')
      }
    } catch (err) {
      setSaveStatus('error')
      setSaveError(err instanceof Error ? err.message : 'Save failed')
    }
  }, [region, decision, task.task_id, currentIndex, regions.length, updateDecision])

  const handleSubmit = useCallback(async () => {
    setSubmitStatus('submitting')
    setSubmitError('')

    try {
      const res = await fetch('/api/review/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: task.task_id }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { error?: string }).error ?? `Server error ${res.status}`)
      }

      setSubmitStatus('success')
      setTimeout(() => router.push('/reviewer'), 1200)
    } catch (err) {
      setSubmitStatus('error')
      setSubmitError(err instanceof Error ? err.message : 'Submit failed')
    }
  }, [task.task_id, router])

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return

      if (e.key === 'ArrowRight' && currentIndex < regions.length - 1) {
        setCurrentIndex((i) => i + 1)
      }
      if (e.key === 'ArrowLeft' && currentIndex > 0) {
        setCurrentIndex((i) => i - 1)
      }
      // Quick decision keys (only when no input focused)
      if (e.key === 'a' || e.key === 'A') {
        if (region) updateDecision(region.region_id, { choice: 'APPROVED', saved: false })
      }
      if (e.key === 't' || e.key === 'T') {
        if (region) updateDecision(region.region_id, { choice: 'TEXT_WRONG', saved: false })
      }
      if (e.key === 's' || e.key === 'S') {
        if (region) updateDecision(region.region_id, { choice: 'SCRIPT_WRONG', saved: false })
      }
      if (e.key === 'b' || e.key === 'B') {
        if (region) updateDecision(region.region_id, { choice: 'BOTH_WRONG', saved: false })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [currentIndex, regions.length, region, updateDecision])

  // ── Early return ─────────────────────────────────────────────────────────

  if (regions.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        No regions found for this task.
      </div>
    )
  }

  // ── Crop CSS ─────────────────────────────────────────────────────────────

  const MAX_DISPLAY = 280
  const MAX_SCALE   = 2.0
  const cropW  = region.cropWidth  || 1
  const cropH  = region.cropHeight || 1
  const scale  = Math.min(MAX_DISPLAY / cropW, MAX_DISPLAY / cropH, MAX_SCALE)
  const displayW = Math.round(cropW * scale)
  const displayH = Math.round(cropH * scale)
  const centerX  = (region.cropXmin + cropW / 2) * scale
  const centerY  = (region.cropYmin + cropH / 2) * scale

  // ── Decision button helper ────────────────────────────────────────────────

  const DecisionBtn = ({
    value,
    label: btnLabel,
    icon,
    className = '',
  }: {
    value: ReviewChoice
    label: string
    icon: React.ReactNode
    className?: string
  }) => {
    const isActive = decision?.choice === value
    return (
      <button
        onClick={() => {
          if (region) updateDecision(region.region_id, { choice: value, saved: false })
        }}
        className={`
          flex-1 flex flex-col items-center gap-1 px-2 py-2 rounded-lg border text-xs font-medium
          transition-colors cursor-pointer
          ${isActive
            ? className
            : 'border-border bg-muted/40 text-muted-foreground hover:bg-muted'}
        `}
        title={`${btnLabel} (${value === 'APPROVED' ? 'A' : value === 'TEXT_WRONG' ? 'T' : value === 'SCRIPT_WRONG' ? 'S' : 'B'})`}
      >
        {icon}
        {btnLabel}
      </button>
    )
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">

      {/* ── LEFT: Full page image ──────────────────────────────────── */}
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
              <img
                src={proxiedImageUrl}
                alt="Full page"
                className="w-full h-auto block"
                loading="eager"
              />

              {/* Bbox overlays for all regions */}
              {regions.map((r, i) => {
                const d   = decisions[r.region_id]
                const col = d?.saved
                  ? d.choice === 'APPROVED' || d.choice === 'SCRIPT_WRONG'
                    ? 'rgba(34,197,94,0.7)'      // green — approved
                    : 'rgba(239,68,68,0.7)'       // red   — needs correction
                  : i === currentIndex
                    ? '#f59e0b'                   // amber — current
                    : 'rgba(99,102,241,0.6)'      // indigo — unseen
                const bg = d?.saved
                  ? d.choice === 'APPROVED' || d.choice === 'SCRIPT_WRONG'
                    ? 'rgba(34,197,94,0.12)'
                    : 'rgba(239,68,68,0.12)'
                  : i === currentIndex
                    ? 'rgba(245,158,11,0.18)'
                    : 'rgba(99,102,241,0.08)'

                return (
                  <div
                    key={r.region_id}
                    onClick={() => setCurrentIndex(i)}
                    title={`Region ${i + 1}`}
                    style={{
                      position:        'absolute',
                      left:            `${r.bbox_x_percent}%`,
                      top:             `${r.bbox_y_percent}%`,
                      width:           `${r.bbox_width_percent}%`,
                      height:          `${r.bbox_height_percent}%`,
                      transform:       r.rotation ? `rotate(${r.rotation}deg)` : undefined,
                      transformOrigin: 'center',
                      cursor:          'pointer',
                      border:          `${i === currentIndex ? '2px' : '1.5px'} solid ${col}`,
                      background:      bg,
                      transition:      'border-color 0.15s, background 0.15s',
                    }}
                  >
                    <span
                      style={{
                        position:     'absolute',
                        top:          -1,
                        left:         -1,
                        fontSize:     '9px',
                        lineHeight:   1,
                        padding:      '1px 3px',
                        background:   col,
                        color:        '#fff',
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

      {/* ── RIGHT: Review panel ───────────────────────────────────── */}
      <div className="lg:w-1/2 xl:w-2/5 flex flex-col overflow-hidden">

        {/* Progress header */}
        <div className="px-5 py-3 border-b bg-card shrink-0 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">
              Region {currentIndex + 1} <span className="text-muted-foreground">of {regions.length}</span>
            </span>
            <span className="text-muted-foreground text-xs">{savedCount}/{regions.length} reviewed</span>
          </div>
          <Progress value={progressPercent} className="h-1.5" />
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-5 space-y-5">

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
                    alt={`Crop of region ${currentIndex + 1}`}
                    style={{
                      position:        'absolute',
                      width:           task.original_width  * scale,
                      height:          task.original_height * scale,
                      left:            -region.cropXmin * scale,
                      top:             -region.cropYmin * scale,
                      transform:       region.rotation ? `rotate(${region.rotation}deg)` : undefined,
                      transformOrigin: `${centerX}px ${centerY}px`,
                      maxWidth:        'none',
                    }}
                  />
                )}
              </div>
            </div>

            {/* Labeler transcription */}
            <div>
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
                Labeler Transcription
              </div>
              {label ? (
                label.is_unreadable ? (
                  <span className="text-sm text-amber-600 font-medium">Marked as unreadable</span>
                ) : (
                  <p className="text-sm font-mono rounded-md bg-muted/40 px-3 py-2 border min-h-[2.5rem] break-words">
                    {label.text || <span className="text-muted-foreground italic">(empty)</span>}
                  </p>
                )
              ) : (
                <p className="text-sm text-muted-foreground italic">No label submitted</p>
              )}
            </div>

            {/* Previous review context (re-review only) */}
            {prevReview && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 space-y-1">
                <p className="text-xs font-medium text-amber-700 uppercase tracking-wide">
                  Previous Review (Round {prevReview.review_round})
                </p>
                <p className="text-xs text-amber-800">
                  Decision: <span className="font-semibold">{prevReview.review_status}</span>
                </p>
                {prevReview.review_note && (
                  <p className="text-xs text-amber-800">Note: {prevReview.review_note}</p>
                )}
              </div>
            )}

            {/* Script tag */}
            <div>
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
                Script Tag
                <span className="ml-1 text-[10px] normal-case text-muted-foreground">
                  (original: {region.script_tag_original})
                </span>
              </div>
              <Select
                value={decision?.scriptTag || region.script_tag_final || region.script_tag_original || ''}
                onValueChange={(val: string | null) => {
                  if (region && val) updateDecision(region.region_id, { scriptTag: val, saved: false })
                }}
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCRIPT_TAGS.map((tag) => (
                    <SelectItem key={tag} value={tag}>
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold ${scriptTagClass(tag)}`}>
                        {tag}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {decision?.scriptTag !== region.script_tag_final && (
                <p className="mt-1 text-xs text-amber-600">Script changed — choose SCRIPT_WRONG or BOTH_WRONG</p>
              )}
            </div>

            {/* Decision buttons */}
            <div>
              <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2 block">
                Decision
                <span className="ml-1 text-[10px] normal-case font-normal">
                  — <kbd className="px-0.5 py-px rounded border bg-muted text-[10px]">A</kbd>pprove&nbsp;
                  <kbd className="px-0.5 py-px rounded border bg-muted text-[10px]">T</kbd>ext wrong&nbsp;
                  <kbd className="px-0.5 py-px rounded border bg-muted text-[10px]">S</kbd>cript wrong&nbsp;
                  <kbd className="px-0.5 py-px rounded border bg-muted text-[10px]">B</kbd>oth wrong
                </span>
              </Label>
              <div className="flex gap-2">
                <DecisionBtn
                  value="APPROVED"
                  label="Approve"
                  icon={<ThumbsUp className="h-4 w-4" />}
                  className="border-emerald-400 bg-emerald-50 text-emerald-700"
                />
                <DecisionBtn
                  value="TEXT_WRONG"
                  label="Text ✗"
                  icon={<Type className="h-4 w-4" />}
                  className="border-red-400 bg-red-50 text-red-700"
                />
                <DecisionBtn
                  value="SCRIPT_WRONG"
                  label="Script ✗"
                  icon={<Tag className="h-4 w-4" />}
                  className="border-amber-400 bg-amber-50 text-amber-700"
                />
                <DecisionBtn
                  value="BOTH_WRONG"
                  label="Both ✗"
                  icon={<ThumbsDown className="h-4 w-4" />}
                  className="border-red-500 bg-red-100 text-red-800"
                />
              </div>
            </div>

            {/* Reviewer note */}
            <div>
              <Label htmlFor="review-note" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Note <span className="normal-case font-normal text-[10px]">(optional — visible to labeler)</span>
              </Label>
              <Textarea
                id="review-note"
                ref={noteRef}
                value={decision?.note ?? ''}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
                  if (region) updateDecision(region.region_id, { note: e.target.value, saved: false })
                }}
                placeholder="Explain the rejection reason…"
                className="mt-1.5 min-h-[60px] text-sm resize-none"
              />
            </div>

            {/* Save status */}
            {saveStatus === 'error' && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {saveError}
              </div>
            )}
            {saveStatus === 'saved' && !decision?.saved && (
              <div className="flex items-center gap-2 text-sm text-emerald-600">
                <CheckCircle2 className="h-4 w-4" />
                Saved
              </div>
            )}

          </div>
        </div>

        {/* ── Footer ────────────────────────────────────────────── */}
        <div className="border-t bg-card px-5 py-4 shrink-0 space-y-3">

          {/* Nav + Save row */}
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
              disabled={saveStatus === 'saving' || !decision?.choice}
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
            title={
              allDone
                ? 'Submit review'
                : `${regions.length - savedCount} region(s) still need a decision`
            }
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
              : `Submit Review (${savedCount}/${regions.length})`}
          </Button>

          {submitError && (
            <p className="text-xs text-destructive text-center">{submitError}</p>
          )}

          {/* Mobile toggle */}
          <button
            onClick={() => setShowFullPage((v) => !v)}
            className="lg:hidden w-full text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            {showFullPage ? 'Hide full page' : 'Show full page'}
          </button>
        </div>

        {/* ── Region mini-map ──────────────────────────────────── */}
        <div className="border-t max-h-36 overflow-y-auto px-4 py-2 bg-muted/20 shrink-0">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5 font-medium">
            All Regions
          </p>
          <div className="flex flex-wrap gap-1">
            {regions.map((r, i) => {
              const d         = decisions[r.region_id]
              const isCurrent = i === currentIndex
              const isSaved   = d?.saved
              const isGreen   = isSaved && (d.choice === 'APPROVED' || d.choice === 'SCRIPT_WRONG')
              const isRed     = isSaved && !isGreen
              return (
                <button
                  key={r.region_id}
                  onClick={() => setCurrentIndex(i)}
                  className={`
                    w-7 h-7 rounded text-[11px] font-semibold transition-colors
                    ${isCurrent
                      ? 'bg-primary text-primary-foreground ring-2 ring-primary/50'
                      : isGreen
                        ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                        : isRed
                          ? 'bg-red-100 text-red-800 hover:bg-red-200'
                          : 'bg-muted text-muted-foreground hover:bg-muted/80'}
                  `}
                  title={`Region ${i + 1}${isSaved ? ` (${d.choice})` : ''}`}
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
