export default function AuthenticatedAppLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-[45vh] flex-1 items-center justify-center p-6"
    >
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-border-default border-t-action-primary-background motion-reduce:animate-none" />
      <span className="sr-only">Loading workspace…</span>
    </div>
  );
}
