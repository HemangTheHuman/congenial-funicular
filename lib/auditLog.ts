import { appendRow } from '@/lib/googleSheets'
import { generateId } from '@/utils/ids'
import { nowISO } from '@/utils/date'

export type AuditAction =
  | 'USER_LOGIN'
  | 'USER_REGISTERED'
  | 'ROLE_ASSIGNED'
  | 'USER_DISABLED'
  | 'TASK_IMPORTED'
  | 'TASK_CLAIMED'
  | 'TASK_RELEASED'
  | 'REGION_LABELED'
  | 'REGION_REVIEWED'
  | 'REGION_CORRECTED'
  | 'TASK_FINAL_APPROVED'
  | 'SYNC_STARTED'
  | 'SYNC_FAILED'
  | 'SYNC_SUCCESS'

/**
 * Writes a row to the audit_logs sheet.
 * Call this from API routes and Server Actions — never from client components.
 *
 * Column order: log_id | timestamp | user_email | action | entity_type |
 *               entity_id | old_value | new_value | metadata
 */
export async function logAction(
  userEmail: string,
  action: AuditAction,
  entityType: string,
  entityId: string,
  oldValue = '',
  newValue = '',
  metadata: Record<string, unknown> = {}
): Promise<void> {
  try {
    await appendRow('audit_logs', [
      generateId('AL'),
      nowISO(),
      userEmail,
      action,
      entityType,
      entityId,
      oldValue,
      newValue,
      Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : '',
    ])
  } catch (err) {
    // Audit log failures must never crash the main request
    console.error('[auditLog] Failed to write audit log:', err)
  }
}
