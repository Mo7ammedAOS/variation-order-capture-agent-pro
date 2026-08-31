'use client';

import { useActionState } from 'react';
import { MessageSquare, Mail } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { dismissMessage, fileMessage, type TriageState } from './actions';

export interface TriageCardProject {
  id: string;
  projectCode: string;
  projectName: string;
}

export interface TriageCardItem {
  eventId: string;
  source: string;
  reason: string;
  senderName: string | null;
  senderIdentifier: string | null;
  text: string;
  receivedAt: string;
  candidateProjectIds: string[];
}

/**
 * One message the system would not place by itself.
 *
 * The reason is shown before the actions, and in the system's own words. The
 * person filing this is being asked to supply a judgement the app refused to
 * guess at, and they can only do that if they know which guess was missing:
 * "on four active projects" and "we do not know who sent this" need completely
 * different responses from them.
 *
 * Projects the sender is actually on are offered first and marked, because
 * they are right nearly every time — but the full list stays available, since
 * the one case this queue exists for is the one where the obvious answer is
 * wrong.
 */
export function TriageCard({
  item,
  projects,
}: {
  item: TriageCardItem;
  projects: TriageCardProject[];
}) {
  const [fileState, fileAction, filing] = useActionState<TriageState, FormData>(fileMessage, {});
  const [dismissState, dismissAction, dismissing] = useActionState<TriageState, FormData>(
    dismissMessage,
    {},
  );

  const Icon = item.source === 'whatsapp' ? MessageSquare : Mail;
  const likely = projects.filter((p) => item.candidateProjectIds.includes(p.id));
  const rest = projects.filter((p) => !item.candidateProjectIds.includes(p.id));
  const state = fileState.error || fileState.ok ? fileState : dismissState;

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-start gap-3">
        <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {item.senderName ?? 'Unknown sender'}
            {item.senderIdentifier ? (
              <span className="ms-2 font-normal text-muted-foreground">
                {item.senderIdentifier}
              </span>
            ) : null}
          </p>
          <p className="text-xs text-muted-foreground">{item.receivedAt}</p>
        </div>
      </div>

      <p className="whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-sm">{item.text}</p>

      <p className="text-sm text-amber-700">
        <span className="font-medium">Not filed: </span>
        {item.reason}
      </p>

      <form action={fileAction} className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input type="hidden" name="eventId" value={item.eventId} />
        <label htmlFor={`project-${item.eventId}`} className="sr-only">
          Project
        </label>
        <select
          id={`project-${item.eventId}`}
          name="projectId"
          defaultValue=""
          className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">Which project is this?</option>
          {likely.length > 0 ? (
            <optgroup label="They are on these">
              {likely.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.projectCode} — {p.projectName}
                </option>
              ))}
            </optgroup>
          ) : null}
          {rest.length > 0 ? (
            <optgroup label={likely.length > 0 ? 'Other projects' : 'Projects'}>
              {rest.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.projectCode} — {p.projectName}
                </option>
              ))}
            </optgroup>
          ) : null}
        </select>
        <Button type="submit" disabled={filing}>
          {filing ? 'Filing…' : 'File it'}
        </Button>
      </form>

      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
          Not a change?
        </summary>
        <form action={dismissAction} className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input type="hidden" name="eventId" value={item.eventId} />
          <Input name="reason" placeholder="Why is this not a change?" className="flex-1" />
          <Button type="submit" variant="outline" disabled={dismissing}>
            {dismissing ? 'Dismissing…' : 'Dismiss'}
          </Button>
        </form>
      </details>

      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state.ok ? <p className="text-sm text-emerald-700">{state.ok}</p> : null}
    </Card>
  );
}
