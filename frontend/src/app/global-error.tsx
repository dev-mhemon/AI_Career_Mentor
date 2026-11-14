'use client';

import { Button } from '@/components/ui/button';
import './globals.css';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen items-center justify-center">
        <main className="mx-auto flex max-w-md flex-col items-center gap-4 p-6 text-center">
          <h1 className="text-heading-lg">Something went wrong</h1>
          <p className="text-body text-text-secondary">A critical error occurred. Try again.</p>
          {error.digest && <p className="font-mono text-caption text-text-muted">Reference: {error.digest}</p>}
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button onClick={reset}>Try again</Button>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- root layout fallback renders outside Next App Router */}
            <a
              href="/"
              className="inline-flex h-10 min-h-11 items-center justify-center rounded-md border border-action-secondary-border bg-action-secondary-background px-5 text-label-lg font-medium text-action-secondary-foreground transition-colors duration-(--duration-fast) ease-standard hover:border-action-secondary-border-hover hover:bg-action-secondary-background-hover active:bg-action-secondary-background-active"
            >
              Back to Home
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
