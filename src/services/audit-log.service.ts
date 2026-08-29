import 'server-only';
import type { ActivitySource, Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/prisma';

/**
 * The audit trail. Append only — never updated, never deleted.
 *
 * `recordAudit` takes a transaction client on purpose. Every mutating service
 * writes its change and its audit event in ONE transaction, so an audit gap
 * cannot happen: either both land or neither does. Calling this after a
 * transaction commits would reintroduce exactly the gap it exists to prevent.
 */

type Db = PrismaClient | Prisma.TransactionClient;

export type RecordType =
  | 'project'
  | 'project_member'
  | 'project_contract_rule'
  | 'contact'
  | 'project_document'
  | 'potential_change'
  | 'task'
  | 'bottleneck'
  | 'user'
  | 'company_settings'
  | 'integration_event'
  | 'notification';

export type ActionType =
  | 'created'
  | 'updated'
  | 'deleted'
  | 'status_changed'
  | 'assigned'
  | 'unassigned'
  | 'uploaded'
  | 'downloaded'
  | 'notice_assessed'
  | 'notice_required'
  | 'notice_not_required'
  | 'notice_needs_information'
  | 'completed'
  | 'blocked'
  | 'resolved'
  | 'invited'
  | 'activated'
  | 'deactivated'
  | 'received'
  | 'ai_suggested';

export interface AuditInput {
  db?: Db;
  projectId?: string | null;
  userId?: string | null;
  recordType: RecordType;
  recordId: string;
  actionType: ActionType;
  oldValue?: unknown;
  newValue?: unknown;
  source?: ActivitySource;
  metadata?: Record<string, unknown>;
}

export async function recordAudit(input: AuditInput): Promise<void> {
  const db = input.db ?? prisma;

  await db.activityLog.create({
    data: {
      projectId: input.projectId ?? null,
      userId: input.userId ?? null,
      recordType: input.recordType,
      recordId: input.recordId,
      actionType: input.actionType,
      oldValueJson: toJson(input.oldValue),
      newValueJson: toJson(input.newValue),
      source: input.source ?? 'web_app',
      metadataJson: toJson(input.metadata),
    },
  });
}

/**
 * Reduces a before/after pair to only what actually changed.
 *
 * Storing whole records makes the log unreadable and, worse, copies commercial
 * values into the audit table on every touch. A diff answers "what changed"
 * directly, which is the question anyone reading an audit log is asking.
 */
export function diffChanges<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
): { oldValue: Partial<T>; newValue: Partial<T> } | null {
  const oldValue: Partial<T> = {};
  const newValue: Partial<T> = {};
  let changed = false;

  for (const key of Object.keys(after) as (keyof T)[]) {
    const previous = before[key];
    const next = after[key];
    if (!isEqual(previous, next)) {
      oldValue[key] = previous;
      newValue[key] = next;
      changed = true;
    }
  }

  return changed ? { oldValue, newValue } : null;
}

function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a === 'object' && typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return String(a) === String(b);
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
