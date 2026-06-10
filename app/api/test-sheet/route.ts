/**
 * GET /api/test-sheet
 *
 * DEV-ONLY smoke test. Verifies Google Sheet connectivity and all Phase 2
 * domain helpers can read from their respective tabs.
 *
 * Remove or gate this behind APP_ENV !== 'production' before going live.
 */

import { testConnection } from '@/lib/googleSheets'
import { listAllUsers } from '@/lib/users'
import { listTasksByStatus } from '@/lib/tasks'
import { getAllConfig, getTaskLockMinutes, getAllowedScriptTags } from '@/lib/appConfig'
import { assertTaskTransition, assertRegionTransition } from '@/lib/transitions'

export const dynamic = 'force-dynamic'

export async function GET() {
  const results: Record<string, unknown> = {}

  // ── Phase 0: raw connection ──────────────────────────────────────────────
  results['connection'] = await testConnection()

  // ── Phase 2: domain helpers ──────────────────────────────────────────────

  try {
    const users = await listAllUsers()
    results['users.listAllUsers'] = { count: users.length, sample: users[0] ?? null }
  } catch (e) {
    results['users.listAllUsers'] = { error: String(e) }
  }

  try {
    const tasks = await listTasksByStatus('READY_FOR_LABELING', 'LABELING_IN_PROGRESS')
    results['tasks.listByStatus'] = { count: tasks.length }
  } catch (e) {
    results['tasks.listByStatus'] = { error: String(e) }
  }

  try {
    const config = await getAllConfig()
    results['appConfig.getAllConfig'] = config
    results['appConfig.getTaskLockMinutes'] = await getTaskLockMinutes()
    results['appConfig.getAllowedScriptTags'] = await getAllowedScriptTags()
  } catch (e) {
    results['appConfig'] = { error: String(e) }
  }

  // ── Transition validator sanity checks (no Sheet call) ───────────────────
  const transitionTests: Record<string, string> = {}

  try {
    assertTaskTransition('IMPORTED', 'READY_FOR_LABELING')
    transitionTests['IMPORTED→READY_FOR_LABELING'] = 'OK'
  } catch (e) {
    transitionTests['IMPORTED→READY_FOR_LABELING'] = String(e)
  }

  try {
    assertTaskTransition('SYNCED_TO_LABEL_STUDIO', 'LABELED')
    transitionTests['SYNCED→LABELED (should throw)'] = 'FAIL — did not throw'
  } catch {
    transitionTests['SYNCED→LABELED (should throw)'] = 'OK — correctly threw'
  }

  try {
    assertRegionTransition('PENDING_LABEL', 'LABELED')
    transitionTests['PENDING_LABEL→LABELED'] = 'OK'
  } catch (e) {
    transitionTests['PENDING_LABEL→LABELED'] = String(e)
  }

  results['transitions'] = transitionTests

  return Response.json({ ok: true, results })
}
