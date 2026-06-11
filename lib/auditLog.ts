/**
 * lib/auditLog.ts — SQL rewrite (Turso)
 *
 * Writes audit events to the audit_logs table.
 * Never throws — audit failures must never crash the main request.
 */
import { db } from '@/lib/db'
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
  | 'TASK_SUBMITTED'
  | 'REGION_LABELED'
  | 'REGION_REVIEWED'
  | 'REGION_CORRECTED'
  | 'TASK_FINAL_APPROVED'
  | 'REVIEW_CLAIMED'
  | 'REVIEW_RELEASED'
  | 'REVIEW_SUBMITTED'
  | 'SYNC_STARTED'
  | 'SYNC_FAILED'
  | 'SYNC_SUCCESS'

/**
 * Writes a row to the audit_logs table.
 * Call this from API routes and Server Actions — never from client components.
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
    await db.execute({
      sql: `INSERT INTO audit_logs
              (log_id, timestamp, user_email, action, entity_type, entity_id, old_value, new_value, metadata)
            VALUES (?,?,?,?,?,?,?,?,?)`,
      args: [
        generateId('AL'),
        nowISO(),
        userEmail,
        action,
        entityType,
        entityId,
        oldValue,
        newValue,
        Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : '',
      ],
    })
  } catch (err) {
    console.error('[auditLog] Failed to write audit log:', err)
  }
}
