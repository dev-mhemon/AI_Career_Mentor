export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="flex min-h-[40vh] items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-border-default border-t-action-primary-background motion-reduce:animate-none" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
