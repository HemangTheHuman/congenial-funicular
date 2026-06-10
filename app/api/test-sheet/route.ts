/**
 * DEV-ONLY test route — verifies Google Sheets read + write.
 * Remove or gate behind APP_ENV check before production.
 *
 * GET /api/test-sheet
 *   1. Reads the app_config sheet (tests read)
 *   2. Appends a test row to audit_logs (tests write)
 *   3. Returns both results
 */

import { readSheetAsObjects, appendRow } from '@/lib/googleSheets'
import { nowISO } from '@/utils/date'
import { generateId } from '@/utils/ids'

export const dynamic = 'force-dynamic'

export async function GET() {
  const results: Record<string, unknown> = {}

  // --- 1. READ test ---
  try {
    const config = await readSheetAsObjects('app_config')
    results.read = {
      ok: true,
      sheet: 'app_config',
      rowCount: config.length,
      sample: config,
    }
  } catch (err) {
    results.read = { ok: false, error: String(err) }
  }

  // --- 2. WRITE test ---
  try {
    const testId = generateId('AL')
    const now = nowISO()
    await appendRow('audit_logs', [
      testId,
      now,
      'system@test',
      'SHEET_WRITE_TEST',
      'system',
      testId,
      '',
      '',
      JSON.stringify({ note: 'Phase 0 connection test — safe to delete' }),
    ])
    results.write = {
      ok: true,
      sheet: 'audit_logs',
      rowAppended: testId,
    }
  } catch (err) {
    results.write = { ok: false, error: String(err) }
  }

  const allOk =
    (results.read as { ok: boolean }).ok && (results.write as { ok: boolean }).ok

  return Response.json(
    {
      success: allOk,
      timestamp: nowISO(),
      ...results,
    },
    { status: allOk ? 200 : 500 }
  )
}
