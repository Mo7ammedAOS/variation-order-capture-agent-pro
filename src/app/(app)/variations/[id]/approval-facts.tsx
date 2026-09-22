/**
 * One labelled fact in the approval summary.
 *
 * Its own file because the approval screen is a server component and the panel
 * around it is a client one: this crosses that line as rendered output, which
 * is the only thing that may cross it cheaply.
 */
export function ApprovalFact({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={wide ? 'sm:col-span-2' : undefined}>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="break-words">{value}</dd>
    </div>
  );
}
