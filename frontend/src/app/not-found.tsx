import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-heading-lg">Page not found</h1>
      <p className="text-body text-text-secondary">That page does not exist or has moved.</p>
      <Link
        href="/"
        className="inline-flex h-10 items-center rounded-md bg-action-primary-background px-4 text-label-lg text-action-primary-foreground hover:bg-action-primary-background-hover"
      >
        Go home
      </Link>
    </main>
  );
}
