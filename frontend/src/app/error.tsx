'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Digest only; never log message/content that may carry user data.
    if (error.digest) console.error('route error digest', error.digest);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-heading-lg">Something went wrong</h1>
      <p className="text-body text-text-secondary">An unexpected error occurred. Your data is safe. Try again.</p>
      {error.digest && <p className="font-mono text-caption text-text-muted">Reference: {error.digest}</p>}
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button onClick={reset}>Try again</Button>
      </div>
    </main>
  );
}
