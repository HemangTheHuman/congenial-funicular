'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Project { id: number; title: string; task_count: number }
interface LsTaskRow {
  lsTaskId: number
  alreadyImported: boolean
  task_id: string | null
  status: string | null
}
interface BatchResultItem {
  lsTaskId: string
  success: boolean
  task_id: string | null
  regionCount: number
  skipped: boolean
  error: string | null
}
interface BatchSummary {
  total: number; imported: number; skipped: number; failed: number
  results: BatchResultItem[]
}

// ---------------------------------------------------------------------------
// Single Import Panel
// ---------------------------------------------------------------------------

export function SingleImportPanel() {
  const [lsTaskId, setLsTaskId] = useState('')
  const [batchId, setBatchId] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string; detail?: string } | null>(null)
  const router = useRouter()

  const handleImport = async () => {
    if (!lsTaskId.trim()) return
    setLoading(true)
    setResult(null)

    try {
      const res = await fetch(`/api/admin/import-task/${lsTaskId.trim()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batch_id: batchId }),
      })
      const data = await res.json()

      if (res.status === 409) {
        setResult({ ok: false, message: `Already imported as ${data.task_id}` })
      } else if (res.status === 422) {
        setResult({ ok: false, message: data.error })
      } else if (!res.ok) {
        setResult({ ok: false, message: data.error ?? 'Import failed', detail: data.detail })
      } else {
        setResult({ ok: true, message: `✓ Imported ${data.regionCount} regions → ${data.task.task_id}` })
        router.refresh()
      }
    } catch (err) {
      setResult({ ok: false, message: 'Network error', detail: String(err) })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="single-ls-task-id">Label Studio Task ID</Label>
          <Input
            id="single-ls-task-id"
            placeholder="e.g. 1234"
            value={lsTaskId}
            onChange={(e) => setLsTaskId(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleImport()}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="single-batch-id">Batch Label <span className="text-muted-foreground">(optional)</span></Label>
          <Input
            id="single-batch-id"
            placeholder="e.g. batch_june_2026"
            value={batchId}
            onChange={(e) => setBatchId(e.target.value)}
          />
        </div>
      </div>

      <Button id="single-import-btn" onClick={handleImport} disabled={loading || !lsTaskId.trim()}>
        {loading ? 'Importing…' : 'Import Task'}
      </Button>

      {result && (
        <Alert variant={result.ok ? 'default' : 'destructive'}>
          <AlertDescription>
            {result.message}
            {result.detail && <span className="block text-xs mt-1 opacity-70">{result.detail}</span>}
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Batch Import Panel
// ---------------------------------------------------------------------------

export function BatchImportPanel() {
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProject, setSelectedProject] = useState('')
  const [taskRows, setTaskRows] = useState<LsTaskRow[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [batchId, setBatchId] = useState('')
  const [loading, setLoading] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [totalInProject, setTotalInProject] = useState<number | null>(null)
  const [summary, setSummary] = useState<BatchSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  // Load projects on mount
  useEffect(() => {
    fetch('/api/admin/list-projects')
      .then((r) => r.json())
      .then((d) => setProjects(d.projects ?? []))
      .catch(() => setError('Failed to load Label Studio projects'))
  }, [])

  // Load tasks when project changes
  const loadTasks = useCallback(async (projectId: string) => {
    setFetching(true)
    setTaskRows([])
    setSelected(new Set())
    setTotalInProject(null)
    try {
      const r = await fetch(`/api/admin/list-tasks?projectId=${projectId}`)
      const d = await r.json()
      setTaskRows(d.tasks ?? [])
      setTotalInProject(d.totalInProject ?? null)
    } catch {
      setError('Failed to load tasks from Label Studio')
    } finally {
      setFetching(false)
    }
  }, [])

  const handleProjectChange = (val: string | null) => {
    if (!val) return
    setSelectedProject(val)
    setSummary(null)
    loadTasks(val)
  }

  const toggleRow = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const toggleAll = () => {
    const importable = taskRows.filter((t) => !t.alreadyImported).map((t) => t.lsTaskId)
    setSelected((prev) => prev.size === importable.length ? new Set() : new Set(importable))
  }

  const handleBatchImport = async () => {
    if (selected.size === 0) return
    setLoading(true)
    setSummary(null)
    try {
      const res = await fetch('/api/admin/import-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lsTaskIds: Array.from(selected), batch_id: batchId }),
      })
      const data: BatchSummary = await res.json()
      setSummary(data)
      router.refresh()
    } catch (err) {
      setError(`Batch import failed: ${String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  const importable = taskRows.filter((t) => !t.alreadyImported)

  return (
    <div className="space-y-5">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="batch-project-select">Label Studio Project</Label>
          <Select onValueChange={handleProjectChange} value={selectedProject}>
            <SelectTrigger id="batch-project-select">
              <SelectValue placeholder="Select a project…" />
            </SelectTrigger>
            <SelectContent>
              {projects.map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>
                  {p.title} ({p.task_count} tasks)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="batch-id-input">Batch Label <span className="text-muted-foreground">(optional)</span></Label>
          <Input
            id="batch-id-input"
            placeholder="e.g. batch_june_2026"
            value={batchId}
            onChange={(e) => setBatchId(e.target.value)}
          />
        </div>
      </div>

      {fetching && <p className="text-sm text-muted-foreground">Loading tasks…</p>}

      {!fetching && taskRows.length === 0 && selectedProject && (
        <p className="text-sm text-muted-foreground">
          No tasks match the filter <code className="text-xs bg-muted px-1 rounded">review=approved &amp; excel=none</code>
          {totalInProject !== null && ` (checked ${totalInProject} tasks in project)`}.
        </p>
      )}

      {!fetching && taskRows.length > 0 && totalInProject !== null && (
        <p className="text-xs text-muted-foreground">
          Showing {taskRows.length} of {totalInProject} tasks
          {' '}where <code className="bg-muted px-1 rounded">review=approved</code> and <code className="bg-muted px-1 rounded">excel=none</code>
        </p>
      )}

      {taskRows.length > 0 && (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <input
                    type="checkbox"
                    id="select-all-tasks"
                    checked={selected.size === importable.length && importable.length > 0}
                    onChange={toggleAll}
                    className="cursor-pointer"
                  />
                </TableHead>
                <TableHead>LS Task ID</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {taskRows.map((t) => (
                <TableRow key={t.lsTaskId} className={t.alreadyImported ? 'opacity-50' : ''}>
                  <TableCell>
                    <input
                      type="checkbox"
                      id={`task-check-${t.lsTaskId}`}
                      checked={selected.has(t.lsTaskId)}
                      disabled={t.alreadyImported}
                      onChange={() => toggleRow(t.lsTaskId)}
                      className="cursor-pointer disabled:cursor-not-allowed"
                    />
                  </TableCell>
                  <TableCell className="font-mono text-sm">{t.lsTaskId}</TableCell>
                  <TableCell>
                    {t.alreadyImported ? (
                      <Badge variant="secondary">Imported — {t.task_id}</Badge>
                    ) : (
                      <Badge variant="outline">Not imported</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {taskRows.length > 0 && (
        <div className="flex items-center gap-3">
          <Button
            id="batch-import-btn"
            onClick={handleBatchImport}
            disabled={loading || selected.size === 0}
          >
            {loading
              ? `Importing ${selected.size} task${selected.size !== 1 ? 's' : ''}…`
              : `Import ${selected.size} selected`}
          </Button>
          {selected.size > 0 && (
            <span className="text-sm text-muted-foreground">{selected.size} task{selected.size !== 1 ? 's' : ''} selected</span>
          )}
        </div>
      )}

      {summary && (
        <div className="space-y-3">
          <div className="flex gap-4 text-sm">
            <span className="text-green-600 font-medium">✓ {summary.imported} imported</span>
            <span className="text-muted-foreground">↷ {summary.skipped} skipped</span>
            {summary.failed > 0 && <span className="text-destructive font-medium">✗ {summary.failed} failed</span>}
          </div>
          {summary.failed > 0 && (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>LS Task ID</TableHead>
                    <TableHead>Error</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.results.filter((r) => !r.success && !r.skipped).map((r) => (
                    <TableRow key={r.lsTaskId}>
                      <TableCell className="font-mono text-sm">{r.lsTaskId}</TableCell>
                      <TableCell className="text-destructive text-sm">{r.error}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
