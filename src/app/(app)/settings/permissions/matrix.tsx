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
  'potentialChange.delete': 'Delete a change permanently',
  'capture.triage': 'Open the capture inbox',
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
          /*
            Brand, not a hardcoded emerald. A granted permission is a STATE, the
            same kind of thing as the active nav item — and the emerald it used
            was a literal Tailwind colour that ignored the theme entirely, so in
            dark mode it stayed a light-mode green. It is also carefully not the
            RAG green: nothing here is a risk signal.
          */
          granted
            ? 'brand-fill border-transparent'
            : 'border-border bg-[var(--glass-soft)] backdrop-blur-md text-transparent hover:bg-muted',
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
        <p className="flex items-center gap-2 text-sm font-semibold text-primary">
          <CheckCircle2 aria-hidden className="size-4" />
          {state.ok}
        </p>
      ) : null}

      <div className="hidden overflow-x-auto lg:block">
        <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky left-0 z-10 bg-[var(--glass-strong)] px-3 py-2 text-left font-medium backdrop-blur-lg"
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
                  className="sticky left-0 z-10 whitespace-nowrap border-t bg-[var(--glass-strong)] px-3 py-1.5 text-left font-normal backdrop-blur-lg"
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

      <RoleAccordion scope={scope} rows={rows} formAction={formAction} />
    </div>
  );
}

/**
 * The same authority, one role at a time.
 *
 * ── Why the matrix cannot simply be scrolled on a phone ───────────────────
 * It is thirty capabilities wide, and the only way to fit thirty column
 * headings is to rotate them ninety degrees. On a laptop that is a reasonable
 * trade — you see the whole authority model at once, which is the entire point
 * of a matrix. On a 375px screen you get four columns at a time, of vertical
 * text, with 28px targets, and you have to remember which row you were on
 * while you scroll sideways to find the column. It is not a layout problem,
 * it is the wrong control.
 *
 * So the phone gets a different question. The matrix answers "who can do
 * what"; this answers "what can a QS do" — which is what an administrator is
 * almost always actually asking, and it happens to be the version that fits.
 *
 * `<details>` rather than component state: the browser gives keyboard support,
 * screen-reader semantics and open/closed for free, and one open role at a
 * time is not worth a `useState` and an effect.
 */
function RoleAccordion({
  scope,
  rows,
  formAction,
}: {
  scope: 'system' | 'project';
  rows: PermissionCell[];
  formAction: (payload: FormData) => void;
}) {
  const columns = ALL_CAPABILITIES.filter(
    (capability) => scope === 'system' || !SYSTEM_ONLY.has(capability),
  );

  return (
    <div className="flex flex-col gap-2 lg:hidden">
      {rows.map((row) => (
        <details key={row.role} className="glass-inset overflow-hidden">
          <summary
            className={cn(
              'flex min-h-[3rem] cursor-pointer list-none items-center justify-between gap-3 px-4 py-3',
              'text-sm font-semibold [&::-webkit-details-marker]:hidden',
            )}
          >
            <span className="min-w-0">
              {row.label}
              {row.locked ? (
                <span className="ms-2 text-xs font-normal text-muted-foreground">
                  outside the company
                </span>
              ) : null}
            </span>
            {/* The count is the summary a person actually wants when the list
                is closed: "what can this role do" in one number. */}
            <span className="shrink-0 text-xs font-bold text-muted-foreground">
              {row.locked
                ? 'none'
                : `${columns.filter((c) => row.granted.includes(c)).length}/${columns.length}`}
            </span>
          </summary>

          <ul className="border-t border-border">
            {columns.map((capability) => {
              const granted = row.granted.includes(capability);
              return (
                <li
                  key={capability}
                  className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-1 last:border-b-0"
                >
                  <span className="min-w-0 text-sm leading-snug">
                    {CAPABILITY_LABELS[capability]}
                  </span>
                  <form action={formAction} className="shrink-0">
                    <MobileToggle
                      scope={scope}
                      role={row.role}
                      capability={capability}
                      granted={granted}
                      locked={Boolean(row.locked)}
                    />
                  </form>
                </li>
              );
            })}
          </ul>
        </details>
      ))}
    </div>
  );
}

/**
 * A switch, at the size a phone expects.
 *
 * ── The hit area and the switch are different boxes ───────────────────────
 * A standard mobile switch is a 44×24 track with a 20px thumb — iOS and
 * Material land within a pixel or two of each other. But this product holds
 * everything tappable to a 44px minimum, and a 24px-tall button breaks that.
 *
 * The two are therefore separated: the BUTTON is an invisible 44×56 target,
 * and the switch it draws inside is the standard 44×24. You get the platform
 * size you expect and a target a thumb can actually hit, which a single
 * element cannot give you at once. The first version made the switch itself
 * 52×32 to satisfy the touch rule, and it looked exactly as oversized as it
 * was.
 */
function MobileToggle({
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
      <span className="inline-flex h-11 w-14 items-center justify-center text-muted-foreground">
        <Lock aria-hidden className="size-4" />
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
        role="switch"
        aria-checked={granted}
        aria-label={`${CAPABILITY_LABELS[capability]} for ${role}`}
        className={cn(
          // The target: invisible, and comfortably past the 44px floor.
          'group/sw inline-flex h-11 w-14 shrink-0 items-center justify-center rounded-xl',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
          pending && 'opacity-50',
        )}
      >
        {/* The switch: 44 × 24, the size every phone draws one. */}
        <span
          aria-hidden
          className={cn(
            'relative block h-6 w-11 rounded-full',
            'transition-colors duration-200 ease-[var(--ease-out-quint)]',
            granted ? 'brand-fill' : 'bg-[var(--muted)] shadow-[var(--glass-recess)]',
          )}
        >
          <span
            className={cn(
              'absolute top-0.5 size-5 rounded-full bg-white shadow-sm',
              'transition-all duration-200 ease-[var(--ease-out-quint)]',
              granted ? 'start-[1.375rem]' : 'start-0.5',
            )}
          />
        </span>
      </button>
    </>
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
        {state.ok ? <span className="text-xs font-semibold text-primary">{state.ok}</span> : null}
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
