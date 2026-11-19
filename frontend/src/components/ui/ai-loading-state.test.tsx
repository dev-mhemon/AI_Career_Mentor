import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { JobAcceptedDTO, JobStatusDTO } from '@/lib/api/client';
import { AILoadingState } from './ai-loading-state';

const JOB_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ROADMAP_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const INITIAL_JOB: JobAcceptedDTO = {
  job_id: JOB_ID,
  kind: 'roadmap_generate',
  status: 'queued',
  poll_url: `/api/v1/jobs/${JOB_ID}`,
  retry_after_seconds: 2,
};

describe('AILoadingState (Component 28)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('polls EP-J01 every retry_after_seconds through queued -> preparing -> succeeded and notifies onJobSucceeded', async () => {
    vi.useFakeTimers();
    const onJobSucceeded = vi.fn();
    const responses: JobStatusDTO[] = [
      {
        job_id: JOB_ID,
        kind: 'roadmap_generate',
        status: 'preparing',
        result_ref: null,
        error: null,
        retryable: false,
        created_at: '2026-11-19T09:00:00.000Z',
        finished_at: null,
      },
      {
        job_id: JOB_ID,
        kind: 'roadmap_generate',
        status: 'succeeded',
        result_ref: { type: 'roadmap', id: ROADMAP_ID },
        error: null,
        retryable: false,
        created_at: '2026-11-19T09:00:00.000Z',
        finished_at: '2026-11-19T09:00:04.000Z',
      },
    ];
    const pollJobStatus = vi.fn(async () => responses.shift()!);

    render(
      <AILoadingState
        job={INITIAL_JOB}
        title="Preparing your career roadmap"
        variant="full_section_skeleton"
        skeletonCount={3}
        pollJobStatus={pollJobStatus}
        onJobSucceeded={onJobSucceeded}
      />,
    );

    const container = screen.getByRole('status');
    expect(container).toHaveAttribute('aria-busy', 'true');
    expect(container).toHaveAttribute('data-variant', 'full_section_skeleton');
    expect(container).toHaveAttribute('data-state', 'queued');

    // Reduced-motion safe skeleton blocks rendered
    const skeletons = container.querySelectorAll('.motion-reduce\\:animate-none');
    expect(skeletons.length).toBeGreaterThanOrEqual(3);

    // 1st poll after 2s -> preparing
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(pollJobStatus).toHaveBeenCalledTimes(1);
    expect(container).toHaveAttribute('aria-busy', 'true');
    expect(container).toHaveAttribute('data-state', 'preparing');

    // 2nd poll after another 2s -> succeeded
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(pollJobStatus).toHaveBeenCalledTimes(2);
    expect(container).toHaveAttribute('aria-busy', 'false');
    expect(container).toHaveAttribute('data-state', 'succeeded');
    expect(onJobSucceeded).toHaveBeenCalledWith(
      { type: 'roadmap', id: ROADMAP_ID },
      expect.objectContaining({ status: 'succeeded' }),
    );
  });

  it('cleans up polling timers and aborts in-flight poll on unmount without cancelling the server job', async () => {
    vi.useFakeTimers();
    const capturedSignals: AbortSignal[] = [];
    const pollJobStatus = vi.fn(
      (_id: string, signal: AbortSignal) =>
        new Promise<JobStatusDTO>((_resolve, reject) => {
          capturedSignals.push(signal);
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        }),
    );

    const { unmount } = render(
      <AILoadingState
        job={INITIAL_JOB}
        title="Generating topic explanation"
        variant="inline_banner"
        pollJobStatus={pollJobStatus}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(pollJobStatus).toHaveBeenCalledTimes(1);
    expect(capturedSignals[0]?.aborted).toBe(false);

    // Unmount aborts client fetch signal & clears timers without calling any cancel endpoint
    unmount();
    expect(capturedSignals[0]?.aborted).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(pollJobStatus).toHaveBeenCalledTimes(1);
  });

  it('renders preserved-data reassurance ("Your information has been saved.") and Retry button on failed_retryable', () => {
    const onRetryJob = vi.fn();
    const failedJob: JobStatusDTO = {
      job_id: JOB_ID,
      kind: 'roadmap_generate',
      status: 'failed',
      result_ref: null,
      error: {
        code: 'AI_TIMEOUT',
        message: 'Provider internal timeout',
        retryable: true,
      },
      retryable: true,
      created_at: '2026-11-19T09:00:00.000Z',
      finished_at: '2026-11-19T09:01:00.000Z',
    };

    render(
      <AILoadingState
        job={failedJob}
        title="Preparing your career roadmap"
        onRetryJob={onRetryJob}
      />,
    );

    const container = screen.getByRole('status');
    expect(container).toHaveAttribute('aria-busy', 'false');
    expect(container).toHaveAttribute('data-state', 'failed_retryable');
    expect(
      screen.getByText(/Your information has been saved\./i),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Retry/i }));
    expect(onRetryJob).toHaveBeenCalledTimes(1);
  });
});
