'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, Camera, CheckCircle2, Pencil, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import {
  addEvidenceAction,
  reopenChangeAction,
  updateChangeAction,
  type EditState,
} from './actions';

/**
 * Correcting a change you reported.
 *
 * Collapsed by default. This is a record people read far more often than they
 * change, and a form sitting open invites edits nobody meant to make.
 *
 * The three actions are separated because they mean different things. Editing
 * fixes what you wrote. Reopening withdraws other people's pending decisions.
 * Adding a photograph contradicts nothing at all. Putting them behind one
 * button would make the mildest of the three feel as consequential as the
 * heaviest, and people would stop using it.
 */

const WORK_STATUSES = [
  ['not_started', 'Not started'],
  ['in_progress', 'In progress'],
  ['completed', 'Completed'],
  ['on_hold', 'On hold'],
] as const;

function Submit({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? busy : label}
    </Button>
  );
}

function Feedback({ state }: { state: EditState }) {
  if (state.error) {
    return (
      <p role="alert" className="flex items-start gap-2 text-sm text-risk-red">
        <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
        {state.error}
      </p>
    );
  }
  if (state.ok) {
    return (
      <p className="flex items-start gap-2 text-sm text-risk-green">
        <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0" />
        {state.ok}
      </p>
    );
  }
  return null;
}

export interface EditPanelProps {
  potentialChangeId: string;
  projectId: string;
  canEdit: boolean;
  canReopen: boolean;
  canAddEvidence: boolean;
  /** False once the change has moved past assessment. */
  editableNow: boolean;
  current: {
    title: string;
    description: string;
    location: string;
    trade: string;
    eventDate: string;
    workStatus: string;
  };
}

export function EditPanel({
  potentialChangeId,
  projectId,
  canEdit,
  canReopen,
  canAddEvidence,
  editableNow,
  current,
}: EditPanelProps) {
  const [editState, editAction] = useActionState<EditState, FormData>(updateChangeAction, {});
  const [reopenState, reopenAction] = useActionState<EditState, FormData>(reopenChangeAction, {});
  const [evidenceState, evidenceAction] = useActionState<EditState, FormData>(
    addEvidenceAction,
    {},
  );

  const [open, setOpen] = useState(false);
  const [reopening, setReopening] = useState(false);

  if (!canEdit && !canReopen && !canAddEvidence) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Pencil aria-hidden className="size-4" />
          Correct or add to this
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {editableNow
            ? 'Nobody has decided anything yet, so you can change it freely.'
            : 'This has moved on, so the wording is fixed until it is reopened. Photographs can still be added.'}
        </p>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {canAddEvidence ? (
          <form action={evidenceAction} className="flex flex-col gap-2.5">
            <input type="hidden" name="potentialChangeId" value={potentialChangeId} />
            <input type="hidden" name="projectId" value={projectId} />
            <Label htmlFor="evidence" className="flex items-center gap-1.5">
              <Camera aria-hidden className="size-3.5" />
              Add photographs or files
            </Label>
            <Input
              id="evidence"
              name="evidence"
              type="file"
              multiple
              accept="image/*,application/pdf"
              className="h-auto py-2"
            />
            <div className="flex items-center gap-3">
              <Submit label="Add to the file" busy="Uploading…" />
            </div>
            <Feedback state={evidenceState} />
          </form>
        ) : null}

        {canEdit && editableNow ? (
          open ? (
            <form action={editAction} className="flex flex-col gap-3 border-t border-border/60 pt-4">
              <input type="hidden" name="potentialChangeId" value={potentialChangeId} />

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="title">What changed</Label>
                <Input id="title" name="title" defaultValue={current.title} required />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="description">Describe it</Label>
                <Textarea
                  id="description"
                  name="description"
                  rows={3}
                  defaultValue={current.description}
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex min-w-0 flex-col gap-1.5">
                  <Label htmlFor="location">Where on site</Label>
                  <Input id="location" name="location" defaultValue={current.location} />
                </div>
                <div className="flex min-w-0 flex-col gap-1.5">
                  <Label htmlFor="trade">Trade</Label>
                  <Input id="trade" name="trade" defaultValue={current.trade} />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex min-w-0 flex-col gap-1.5">
                  <Label htmlFor="eventDate">When it happened</Label>
                  <Input
                    id="eventDate"
                    name="eventDate"
                    type="date"
                    defaultValue={current.eventDate}
                  />
                  {/* Said here because it is the one field on this form that
                      moves a contractual date, and it does so silently. */}
                  <p className="text-xs text-muted-foreground">
                    Moving this moves the notice deadline with it.
                  </p>
                </div>
                <div className="flex min-w-0 flex-col gap-1.5">
                  <Label htmlFor="workStatus">Work status</Label>
                  <Select id="workStatus" name="workStatus" defaultValue={current.workStatus}>
                    {WORK_STATUSES.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>

              <Feedback state={editState} />

              <div className="flex flex-wrap items-center gap-3">
                <Submit label="Save changes" busy="Saving…" />
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="text-sm text-muted-foreground underline-offset-4 hover:underline"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div className="border-t border-border/60 pt-4">
              <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
                <Pencil aria-hidden className="size-4" />
                Edit the details
              </Button>
            </div>
          )
        ) : null}

        {canReopen && !editableNow ? (
          <div className="border-t border-border/60 pt-4">
            {reopening ? (
              <form action={reopenAction} className="flex flex-col gap-2.5">
                <input type="hidden" name="potentialChangeId" value={potentialChangeId} />
                <Label htmlFor="reason">Why does this need reopening?</Label>
                <Textarea
                  id="reason"
                  name="reason"
                  rows={2}
                  required
                  placeholder="What was wrong, or what has come to light since."
                />
                <p className="text-xs text-muted-foreground">
                  This sends the change back for rework and withdraws any approval still
                  pending. Approvals already given stay on the record; they simply no longer
                  apply to the new version.
                </p>
                <Feedback state={reopenState} />
                <div className="flex flex-wrap items-center gap-3">
                  <Submit label="Reopen it" busy="Reopening…" />
                  <button
                    type="button"
                    onClick={() => setReopening(false)}
                    className="text-sm text-muted-foreground underline-offset-4 hover:underline"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setReopening(true)}
                >
                  <RotateCcw aria-hidden className="size-4" />
                  Reopen for changes
                </Button>
                <Feedback state={reopenState} />
              </>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
