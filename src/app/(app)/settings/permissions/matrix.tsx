'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, Check, CheckCircle2, Lock, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ALL_CAPABILITIES, type Capability } from '@/lib/rbac';
import {
  resetPermissionsAction,
  togglePermissionAction,
  type PermissionState,
} from './actions';

/**
 * The authority matrix, as a grid of toggles.
 *
 * Roles down the side, capabilities across the top, because an admin arrives
 * asking "what can a QS do" far more often than "who can price". Each cell is
 * its own form, so a mis-click changes one grant and the page never holds a
 * pile of unsaved edits that a refresh would silently discard.
 */

export interface PermissionCell {
  role: string;
  label: string;
  locked?: boolean;
  granted: Capability[];
}

const CAPABILITY_LABELS: Record<Capability, string> = {
  'potentialChange.cancel': 'Cancel or reinstate a change',
  'pricing.submit': 'Price a change',
  'potentialChange.updateOwn': 'Edit a change they reported',
  'potentialChange.reopen': 'Reopen a change for rework',
  'approval.projectManager': 'Approve as project manager',
  'approval.managingDirector': 'Approve as managing director',
  'project.create': 'Create projects',
  'project.update': 'Edit projects',
  'project.viewAll': 'See every project',
  'project.manageMembers': 'Manage team',
  'project.manageContractRules': 'Set contract rules',
  'contact.manage': 'Manage contacts',
  'document.upload': 'Upload evidence',
  'document.manageRegister': 'Controlled documents',
  'potentialChange.create': 'Raise a change',
  'potentialChange.update': 'Edit a change',
  'potentialChange.assessNotice': 'Assess the notice',
  'notice.draft': 'Write the notice',
  'notice.acknowledge': 'Record the acknowledgement',
  'variationOrder.manage': 'Put variations to the client',
  'invoice.manage': 'Apply for payment',
  'payment.record': 'Record money received',
  'potentialChange.changeStatus': 'Move the status',
  'task.assign': 'Assign tasks',
  'task.complete': 'Complete tasks',
  'bottleneck.manage': 'Manage bottlenecks',
  'user.manage': 'Manage users',
  'companySettings.manage': 'Company settings',
};

/** Capabilities that mean nothing on a project role, so the cell is not drawn. */
const SYSTEM_ONLY: ReadonlySet<Capability> = new Set([
  'project.create',
  'project.viewAll',
  'user.manage',
  'companySettings.manage',
]);

function Cell({
  scope,
  role,
  capability,
  granted,
  locked,
}: {
  scope: 'system' | 'project';
  role: string;
  capability: Capability;
  granted: boolean;
  locked: boolean;
}) {
  const { pending } = useFormStatus();

  if (locked) {
    return (
      <span
        title="People outside the company can never be granted authority"
        className="inline-flex size-7 items-center justify-center rounded-md bg-muted/60 text-muted-foreground"
      >
        <Lock aria-hidden className="size-3" />
        <span className="sr-only">Locked</span>
      </span>
    );
  }

  return (
    <>
      <input type="hidden" name="scope" value={scope} />
      <input type="hidden" name="role" value={role} />
      <input type="hidden" name="capability" value={capability} />
      <input type="hidden" name="granted" value={String(granted)} />
      <button
        type="submit"
        disabled={pending}
        aria-pressed={granted}
        aria-label={`${CAPABILITY_LABELS[capability]} for ${role}`}
        className={cn(
          'inline-flex size-7 items-center justify-center rounded-md border transition-colors',
          granted
            ? 'border-emerald-600/30 bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25'
            : 'border-border bg-background text-transparent hover:bg-muted',
          pending && 'opacity-50',
        )}
      >
        <Check aria-hidden className="size-3.5" />
      </button>
    </>
  );
}

export function PermissionMatrixTable({
  scope,
  rows,
}: {
  scope: 'system' | 'project';
  rows: PermissionCell[];
}) {
  const [state, formAction] = useActionState<PermissionState, FormData>(
    togglePermissionAction,
    {},
  );

  const columns = ALL_CAPABILITIES.filter(
    (capability) => scope === 'system' || !SYSTEM_ONLY.has(capability),
  );

  return (
    <div className="flex flex-col gap-2">
      {state.error ? (
        <p className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle aria-hidden className="size-4" />
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p className="flex items-center gap-2 text-sm text-emerald-700">
          <CheckCircle2 aria-hidden className="size-4" />
          {state.ok}
        </p>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky left-0 z-10 bg-card px-3 py-2 text-left font-medium"
              >
                Role
              </th>
              {columns.map((capability) => (
                <th
                  key={capability}
                  scope="col"
                  className="h-32 px-1 pb-2 align-bottom font-medium text-muted-foreground"
                >
                  <span className="block [writing-mode:vertical-rl] rotate-180 whitespace-nowrap text-xs">
                    {CAPABILITY_LABELS[capability]}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.role} className="border-t">
                <th
                  scope="row"
                  className="sticky left-0 z-10 whitespace-nowrap border-t bg-card px-3 py-1.5 text-left font-normal"
                >
                  {row.label}
                  {row.locked ? (
                    <span className="ms-2 text-xs text-muted-foreground">outside the company</span>
                  ) : null}
                </th>
                {columns.map((capability) => (
                  <td key={capability} className="border-t px-1 py-1.5 text-center">
                    <form action={formAction} className="inline">
                      <Cell
                        scope={scope}
                        role={row.role}
                        capability={capability}
                        granted={row.granted.includes(capability)}
                        locked={Boolean(row.locked)}
                      />
                    </form>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ResetDefaultsButton() {
  const [state, formAction] = useActionState<PermissionState, FormData>(
    resetPermissionsAction,
    {},
  );
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button type="button" variant="outline" onClick={() => setConfirming(true)}>
          <RotateCcw aria-hidden className="size-4" />
          Reset to defaults
        </Button>
        {state.ok ? <span className="text-xs text-emerald-700">{state.ok}</span> : null}
        {state.error ? <span className="text-xs text-destructive">{state.error}</span> : null}
      </div>
    );
  }

  return (
    <form action={formAction} className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">
        Discard every change and restore the shipped matrix?
      </span>
      <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
        Cancel
      </Button>
      <Button type="submit" variant="destructive">
        Reset
      </Button>
    </form>
  );
}
