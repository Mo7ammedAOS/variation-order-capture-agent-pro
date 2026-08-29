'use client';

import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Printing is the browser's job, not ours.
 *
 * The alternative is a server-side PDF renderer — another dependency, another
 * font stack, another thing to break on the VPS — to produce a worse copy of
 * what the browser already renders correctly. "Save as PDF" in the print dialog
 * is a real PDF, with selectable text, on whatever paper size the person
 * actually uses.
 */
export function PrintButton() {
  return (
    <Button type="button" variant="outline" onClick={() => window.print()} className="print:hidden">
      <Printer aria-hidden className="size-4" />
      Print or save as PDF
    </Button>
  );
}
