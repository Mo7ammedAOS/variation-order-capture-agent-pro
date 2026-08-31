'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronDown, Search, SlidersHorizontal, X } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const STATUSES = [
  'new_potential_change', 'notice_assessment', 'notice_required', 'needs_evidence',
  'pm_scope_review', 'qs_pricing', 'cm_review', 'internal_approval',
  'variation_approved', 'included_scope', 'cancelled',
];

/**
 * Filters live in the URL rather than component state, so a filtered register
 * is a link someone can paste into a message. "Look at the four overdue ones"
 * is a far more useful thing to send than a screenshot.
 *
 * On a phone the three dropdowns collapse behind a toggle. Stacked, they and
 * the search box filled the entire first screen, so the register itself began
 * below the fold — someone opening this on site had to scroll past the
 * controls to reach the one thing they came for. Search stays visible because
 * it is the field actually used in a corridor; the count on the toggle keeps a
 * collapsed filter from being an invisible one, which is the failure mode that
 * makes people think records have gone missing.
 */
export function RegisterFilters({ projects }: { projects: { id: string; label: string }[] }) {
  const router = useRouter();
  const params = useSearchParams();

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`/variations?${next.toString()}`);
  }

  const [openOnMobile, setOpenOnMobile] = useState(false);

  const hasFilters = [...params.keys()].length > 0;
  const activeCount = ['projectId', 'status', 'risk'].filter((key) => params.get(key)).length;

  return (
    <Card className="p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="flex flex-col gap-1.5 lg:col-span-2">
          <Label htmlFor="filter-q">Search</Label>
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id="filter-q"
              defaultValue={params.get('q') ?? ''}
              placeholder="PC number, title, description"
              className="ps-9"
              onKeyDown={(event) => {
                if (event.key === 'Enter') setParam('q', event.currentTarget.value);
              }}
            />
          </div>
        </div>

        <button
          type="button"
          onClick={() => setOpenOnMobile((value) => !value)}
          aria-expanded={openOnMobile}
          aria-controls="register-filter-fields"
          className={cn(
            'flex h-10 items-center justify-between rounded-md border border-input px-3',
            'text-sm font-medium sm:hidden',
          )}
        >
          <span className="flex items-center gap-2">
            <SlidersHorizontal aria-hidden className="size-4" />
            Filters
            {activeCount > 0 ? (
              <span className="rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">
                {activeCount}
              </span>
            ) : null}
          </span>
          <ChevronDown
            aria-hidden
            className={cn('size-4 transition-transform', openOnMobile && 'rotate-180')}
          />
        </button>

        <div
          id="register-filter-fields"
          className={cn(
            'grid gap-3 sm:contents',
            openOnMobile ? 'grid' : 'hidden',
          )}
        >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-project">Project</Label>
          <Select
            id="filter-project"
            defaultValue={params.get('projectId') ?? ''}
            onChange={(event) => setParam('projectId', event.target.value)}
          >
            <option value="">All projects</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.label}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-status">Status</Label>
          <Select
            id="filter-status"
            defaultValue={params.get('status') ?? ''}
            onChange={(event) => setParam('status', event.target.value)}
          >
            <option value="">Any status</option>
            {STATUSES.map((status) => (
              <option key={status} value={status} className="capitalize">
                {status.replace(/_/g, ' ')}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-risk">Risk</Label>
          <Select
            id="filter-risk"
            defaultValue={params.get('risk') ?? ''}
            onChange={(event) => setParam('risk', event.target.value)}
          >
            <option value="">Any risk</option>
            <option value="red">Critical</option>
            <option value="amber">Warning</option>
            <option value="green">Low</option>
          </Select>
        </div>
        </div>
      </div>

      {hasFilters ? (
        <div className="mt-3">
          <Button variant="ghost" size="sm" onClick={() => router.replace('/variations')}>
            <X aria-hidden className="size-4" />
            Clear filters
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
