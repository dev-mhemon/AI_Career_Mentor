import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  NetworkError,
  submitRating,
  submitReport,
  type RatingResponseDTO,
  type ReportResponseDTO,
} from '@/lib/api/client';
import { buildFeedbackStorageKey } from '@/lib/feedback-storage';
import { AIFeedbackComponent } from './ai-feedback-component';

vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/client')>();
  return {
    ...actual,
    submitRating: vi.fn(),
    submitReport: vi.fn(),
  };
});

function makeFakeJwt(sub: string, sigSuffix = 'sig-1'): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = btoa(JSON.stringify({ sub, jti: sigSuffix }));
  return `${header}.${payload}.fake-secret-${sigSuffix}`;
}

describe('AIFeedbackComponent (Component 29 — EP-F01, EP-F02, R16, R34)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it('renders rating-only, report-only, and combined capabilities independently without inferring report from rating (R34)', () => {
    // 1. Rating-only mode (e.g. technology_update) -> zero report button
    const { rerender } = render(
      <AIFeedbackComponent
        accessToken="tok-1"
        ratingTarget={{ type: 'technology_update', id: 'tu-1' }}
      />,
    );

    expect(screen.getByText('Rate quality:')).toHaveClass(
      'text-sm',
      'font-medium',
      'text-slate-700',
    );
    const radioGroup = screen.getByRole('radiogroup', {
      name: 'Rate this content',
    });
    expect(radioGroup).toHaveClass('gap-0.5');
    expect(within(radioGroup).getAllByRole('radio')).toHaveLength(5);
    expect(
      screen.queryByRole('button', { name: /report issue/i }),
    ).not.toBeInTheDocument();

    // 2. Report-only mode (e.g. quiz_question) -> zero star radiogroup
    rerender(
      <AIFeedbackComponent
        accessToken="tok-1"
        reportTarget={{ type: 'quiz_question', id: 'qq-1' }}
      />,
    );
    expect(
      screen.queryByRole('radiogroup', { name: 'Rate this content' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /report issue/i }),
    ).toBeInTheDocument();

    // 3. Combined mode with distinct target types/IDs (e.g. Screen 12 roadmap_draft + roadmap_content)
    rerender(
      <AIFeedbackComponent
        accessToken="tok-1"
        ratingTarget={{ type: 'roadmap_draft', id: 'ver-uuid-1' }}
        reportTarget={{ type: 'roadmap_content', id: 'roadmap-uuid-1' }}
      />,
    );
    expect(
      screen.getByRole('radiogroup', { name: 'Rate this content' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /report issue/i }),
    ).toBeInTheDocument();
  });

  it('applies distinct color levels 1..5 with smooth fill/color hover transition and responsive star sizing', () => {
    render(
      <AIFeedbackComponent
        accessToken="tok-1"
        ratingTarget={{ type: 'topic_content', id: 'top-colors' }}
      />,
    );

    const radioGroup = screen.getByRole('radiogroup', {
      name: 'Rate this content',
    });
    const stars = within(radioGroup).getAllByRole('radio');

    // Initially all unfilled -> text-slate-300 + transparent SVG fill + responsive h-5 w-5 sm:h-6 sm:w-6
    for (const star of stars) {
      expect(star).toHaveClass(
        'text-slate-300',
        'p-1',
        'sm:p-1.5',
        'duration-200',
        'ease-out',
        'hover:scale-110',
        'active:scale-95',
      );
      const svg = star.querySelector('svg');
      expect(svg).toHaveAttribute('fill', 'transparent');
      expect(svg).toHaveClass(
        'h-5',
        'w-5',
        'sm:h-6',
        'sm:w-6',
        'transition-[color,fill,transform]',
        'duration-200',
      );
    }

    const expectedLevelClasses = [
      'text-rose-500',
      'text-orange-500',
      'text-amber-400',
      'text-lime-500',
      'text-emerald-500',
    ] as const;

    expectedLevelClasses.forEach((levelClass, idx) => {
      fireEvent.mouseEnter(stars[idx]);
      for (let i = 0; i <= idx; i += 1) {
        expect(stars[i]).toHaveClass(levelClass);
        expect(stars[i].querySelector('svg')).toHaveAttribute(
          'fill',
          'currentColor',
        );
      }
      for (let i = idx + 1; i < 5; i += 1) {
        expect(stars[i]).toHaveClass('text-slate-300');
        expect(stars[i].querySelector('svg')).toHaveAttribute(
          'fill',
          'transparent',
        );
      }
    });

    fireEvent.mouseLeave(radioGroup);
    expect(stars[0]).toHaveClass('text-slate-300');
  });

  it('submits 1..5 star rating + upserts updated score, shows compact (N) readout, floating toast, and editable review preview while preserving input on error (R16)', async () => {
    const onRated = vi.fn();
    vi.mocked(submitRating)
      .mockRejectedValueOnce(
        new ApiError(503, 'Service unavailable', 'SERVICE_UNAVAILABLE'),
      )
      .mockResolvedValueOnce({
        target_type: 'topic_content',
        target_id: 'top-1',
        score: 4,
      })
      .mockResolvedValueOnce({
        target_type: 'topic_content',
        target_id: 'top-1',
        score: 5,
      });

    render(
      <AIFeedbackComponent
        accessToken="tok-1"
        ratingTarget={{ type: 'topic_content', id: 'top-1' }}
        onRated={onRated}
      />,
    );

    const star4 = screen.getByRole('radio', { name: '4 stars' });
    fireEvent.click(star4);

    const commentBox = screen.getByLabelText(/Rating comment/i);

    // 501 astral emojis -> exceeds 500 Unicode code points, disables submit
    fireEvent.change(commentBox, { target: { value: '🚀'.repeat(501) } });
    expect(screen.getByText('501 / 500')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Submit rating/i }),
    ).toBeDisabled();

    // 500 Unicode code points ('🚀' x 494 + ' দারুণ' [6 code points] = 500 code points, 994 UTF-16 units)
    const validComment = `  ${'🚀'.repeat(494)} দারুণ  `;
    expect(Array.from(validComment.trim()).length).toBe(500);
    fireEvent.change(commentBox, { target: { value: validComment } });

    // First attempt fails -> input & selected star MUST be preserved (R16)
    fireEvent.click(screen.getByRole('button', { name: /Submit rating/i }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(commentBox).toHaveValue(validComment);
    expect(star4).toHaveAttribute('aria-checked', 'true');

    // Retry succeeds -> trims comment, shows compact (4), floating Toast, and Your review preview
    fireEvent.click(screen.getByRole('button', { name: /Submit rating/i }));
    await waitFor(() => {
      expect(submitRating).toHaveBeenLastCalledWith(
        'tok-1',
        {
          target_type: 'topic_content',
          target_id: 'top-1',
          score: 4,
          comment: validComment.trim(),
        },
        { timeoutMs: 15_000 },
      );
    });
    expect(await screen.findByTestId('ai-feedback-score')).toHaveTextContent(
      '(4)',
    );
    expect(screen.queryByText('Saved (4/5)')).not.toBeInTheDocument();

    const toast = await screen.findByTestId('toast-container');
    expect(toast).toHaveTextContent('Rating saved');
    expect(toast).toHaveTextContent('4/5');

    const reviewPreview = screen.getByTestId('ai-feedback-review-preview');
    expect(reviewPreview).toHaveClass('bg-transparent');
    expect(reviewPreview).not.toHaveClass('bg-slate-50/90');
    expect(reviewPreview).not.toHaveClass('bg-slate-50');
    expect(reviewPreview).not.toHaveClass('bg-white');
    expect(within(reviewPreview).getByText('Your review')).toHaveClass(
      'text-sm',
      'font-medium',
      'text-slate-700',
    );
    expect(reviewPreview).not.toHaveTextContent('4/5');
    expect(reviewPreview).toHaveTextContent(validComment.trim());
    const editBtn = within(reviewPreview).getByRole('button', { name: 'Edit' });
    expect(editBtn).toHaveClass('inline-flex', 'items-center', 'gap-1.5', 'text-sm');
    expect(editBtn.querySelector('svg')).toHaveClass('h-3.5', 'w-3.5', 'block', 'shrink-0');
    expect(onRated).toHaveBeenCalledWith(4);

    // Click Edit -> re-opens form pre-filled with saved comment; upsert to 5 stars
    fireEvent.click(editBtn);
    expect(screen.getByLabelText(/Rating comment/i)).toHaveValue(
      validComment.trim(),
    );
    fireEvent.click(screen.getByRole('radio', { name: '5 stars' }));
    fireEvent.click(screen.getByRole('button', { name: /Update rating/i }));
    await waitFor(() => {
      expect(screen.getByTestId('ai-feedback-score')).toHaveTextContent('(5)');
    });
    expect(screen.getByTestId('ai-feedback-review-preview')).not.toHaveTextContent(
      '5/5',
    );
    expect(onRated).toHaveBeenLastCalledWith(5);
  });

  it('hides the "Your review" summary block when user submits stars only (no review comment text)', async () => {
    vi.mocked(submitRating).mockResolvedValueOnce({
      target_type: 'topic_content',
      target_id: 'top-stars-only',
      score: 2,
    });

    render(
      <AIFeedbackComponent
        accessToken="tok-1"
        ratingTarget={{ type: 'topic_content', id: 'top-stars-only' }}
      />,
    );

    fireEvent.click(screen.getByRole('radio', { name: '2 stars' }));
    fireEvent.click(screen.getByRole('button', { name: /Submit rating/i }));

    expect(await screen.findByTestId('ai-feedback-score')).toHaveTextContent(
      '(2)',
    );
    expect(
      screen.queryByTestId('ai-feedback-review-preview'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Your review')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Edit' }),
    ).not.toBeInTheDocument();
  });

  it('persists submitted rating and report across remount/refresh with separated summary cards and never stores raw JWT', async () => {
    const jwt = makeFakeJwt('user-uuid-42');
    vi.mocked(submitRating).mockResolvedValueOnce({
      target_type: 'topic_content',
      target_id: 'top-persist',
      score: 4,
    });
    vi.mocked(submitReport).mockResolvedValueOnce({
      report_id: 'rep-persist-1',
      status: 'received',
    });

    const { unmount } = render(
      <AIFeedbackComponent
        accessToken={jwt}
        ratingTarget={{ type: 'topic_content', id: 'top-persist' }}
        reportTarget={{ type: 'topic_content', id: 'top-persist' }}
      />,
    );

    // Submit rating + comment
    fireEvent.click(screen.getByRole('radio', { name: '4 stars' }));
    fireEvent.change(screen.getByLabelText(/Rating comment/i), {
      target: { value: 'Clear explanation with practical SQL examples.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Submit rating/i }));
    expect(await screen.findByTestId('ai-feedback-score')).toHaveTextContent(
      '(4)',
    );

    // Submit report + reason + comment
    fireEvent.click(screen.getByRole('button', { name: /report issue/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(
      within(dialog).getByRole('radio', { name: /Outdated content/i }),
    );
    fireEvent.change(within(dialog).getByLabelText(/Additional details/i), {
      target: { value: 'Mentions deprecated API flag.' },
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: /Submit report/i }),
    );
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    // Action bar uses strictly symmetric my-0 py-3 and items-center midline alignment
    const actionRow = screen.getByTestId('ai-feedback-action-row');
    expect(actionRow).toHaveClass(
      'my-0',
      'flex',
      'flex-wrap',
      'items-center',
      'justify-between',
      'gap-3',
      'py-3',
    );

    // Report section has divider and stacked heading -> reason (no middot) -> comment
    const reportSection = screen.getByTestId('ai-feedback-report-section');
    expect(reportSection).toHaveClass('border-t', 'border-slate-100', 'pt-3');

    const immediateReport = screen.getByTestId('ai-feedback-report-preview');
    expect(immediateReport.textContent).not.toContain('·');
    const reportHeading = within(immediateReport).getByText('Your report');
    expect(reportHeading).toHaveClass('text-sm', 'font-medium', 'text-red-700');
    const reportReason = within(immediateReport).getByText('Outdated content');
    expect(reportReason).toHaveClass('mt-1', 'text-sm', 'font-medium', 'text-slate-900');
    const immediateReportText = within(immediateReport).getByText(
      'Mentions deprecated API flag.',
    );
    expect(immediateReportText).toHaveClass(
      'mt-1',
      'text-sm',
      'text-slate-600',
      'whitespace-pre-wrap',
      'break-words',
    );

    // Verify raw JWT and its signature are never stored in localStorage keys or values
    const jwtSignature = jwt.split('.')[2]!;
    const storedKeys = Object.keys(window.localStorage);
    expect(storedKeys.length).toBe(1);
    expect(storedKeys[0]).not.toContain(jwt);
    expect(storedKeys[0]).not.toContain(jwtSignature);
    expect(window.localStorage.getItem(storedKeys[0])).not.toContain(jwt);
    expect(window.localStorage.getItem(storedKeys[0])).not.toContain(
      jwtSignature,
    );

    // Simulate full page refresh (unmount + remount with a genuinely different refreshed JWT for same user sub)
    unmount();
    const refreshedJwt = makeFakeJwt('user-uuid-42', 'sig-2');
    expect(refreshedJwt).not.toBe(jwt);
    render(
      <AIFeedbackComponent
        accessToken={refreshedJwt}
        ratingTarget={{ type: 'topic_content', id: 'top-persist' }}
        reportTarget={{ type: 'topic_content', id: 'top-persist' }}
      />,
    );

    // Filled stars, (4) readout, transparent Your review (no 4/5 duplicate), red Reported badge, and Your report comment all persist!
    expect(screen.getByTestId('ai-feedback-score')).toHaveTextContent('(4)');
    expect(screen.getByRole('radio', { name: '4 stars' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    const persistedReview = screen.getByTestId('ai-feedback-review-preview');
    expect(persistedReview).toHaveClass('bg-transparent');
    expect(persistedReview).toHaveTextContent('Your review');
    expect(persistedReview).not.toHaveTextContent('4/5');
    expect(persistedReview).toHaveTextContent(
      'Clear explanation with practical SQL examples.',
    );

    const reportedBadge = screen.getByText('Reported').closest('[aria-disabled]');
    expect(reportedBadge).toHaveAttribute('aria-disabled', 'true');
    expect(reportedBadge).toHaveClass('border-red-200', 'bg-red-50', 'text-red-700');
    expect(
      screen.queryByRole('button', { name: /report issue/i }),
    ).not.toBeInTheDocument();

    const persistedReport = screen.getByTestId('ai-feedback-report-preview');
    expect(persistedReport).toHaveTextContent('Your report');
    expect(persistedReport).toHaveTextContent('Outdated content');
    expect(
      within(persistedReport).getByText('Mentions deprecated API flag.'),
    ).toBeInTheDocument();
  });

  it('opens compound Report modal, validates 1000 Unicode code points, preserves input on error, restores focus on Escape, and renders red Reported badge + toast + report preview on success', async () => {
    const onReported = vi.fn();
    vi.mocked(submitReport)
      .mockRejectedValueOnce(
        new ApiError(500, 'Internal error', 'INTERNAL_ERROR', 'req-500'),
      )
      .mockResolvedValueOnce({
        report_id: 'rep-ok-1',
        status: 'received',
      });

    render(
      <AIFeedbackComponent
        accessToken="tok-1"
        reportTarget={{ type: 'practice_review', id: 'rev-1' }}
        defaultReportReason="unfair_scoring"
        onReported={onReported}
      />,
    );

    const triggerBtn = screen.getByRole('button', { name: /report issue/i });
    triggerBtn.focus();
    fireEvent.click(triggerBtn);

    const dialog = await screen.findByRole('dialog', {
      name: /Report content issue/i,
    });

    // Default reason is pre-selected to unfair_scoring
    const unfairRadio = within(dialog).getByRole('radio', {
      name: /Unfair AI scoring/i,
    });
    expect(unfairRadio).toBeChecked();

    // Switch reason to outdated + test 1001 code-point ceiling
    const outdatedRadio = within(dialog).getByRole('radio', {
      name: /Outdated content/i,
    });
    fireEvent.click(outdatedRadio);

    const detailsBox = within(dialog).getByLabelText(/Additional details/i);
    fireEvent.change(detailsBox, { target: { value: '🔥'.repeat(1001) } });
    expect(within(dialog).getByText('1001 / 1000')).toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', { name: /Submit report/i }),
    ).toBeDisabled();

    // Valid comment -> submit fails -> preserves reason + comment inside open modal (R16)
    const preservedText = 'আমার উত্তর সঠিক ছিল কিন্তু রুব্রিক তা ধরতে পারেনি।';
    fireEvent.change(detailsBox, { target: { value: preservedText } });
    fireEvent.click(
      within(dialog).getByRole('button', { name: /Submit report/i }),
    );

    expect(await within(dialog).findByRole('alert')).toBeInTheDocument();
    expect(outdatedRadio).toBeChecked();
    expect(detailsBox).toHaveValue(preservedText);

    // Escape closes modal and restores focus to trigger button
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(document.activeElement).toBe(triggerBtn);

    // Reopen and succeed -> red Reported badge + floating Toast + Your report preview
    fireEvent.click(triggerBtn);
    const reopenedDialog = await screen.findByRole('dialog');
    fireEvent.click(
      within(reopenedDialog).getByRole('button', { name: /Submit report/i }),
    );

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(onReported).toHaveBeenCalledWith('rep-ok-1');

    const reportedBadge = screen.getByText('Reported').closest('[aria-disabled]');
    expect(reportedBadge).toHaveAttribute('aria-disabled', 'true');
    expect(reportedBadge).toHaveClass(
      'border-red-200',
      'bg-red-50',
      'text-red-700',
    );
    expect(reportedBadge?.querySelector('svg')).toHaveClass('text-red-600');

    const toast = await screen.findByTestId('toast-container');
    expect(toast).toHaveTextContent('Report submitted');
    expect(screen.queryByText('Report received')).not.toBeInTheDocument();

    const reportPreview = screen.getByTestId('ai-feedback-report-preview');
    expect(reportPreview).toHaveTextContent('Your report');
    expect(reportPreview).toHaveTextContent('Outdated content');
    expect(reportPreview).toHaveTextContent(preservedText);
  });

  it('reconciles 409 REPORT_ALREADY_SUBMITTED into red disabled "Reported" badge, emits info Toast, and persists Reported across remount/refresh', async () => {
    vi.mocked(submitReport).mockRejectedValueOnce(
      new ApiError(
        409,
        'Duplicate report',
        'REPORT_ALREADY_SUBMITTED',
        'req-409',
      ),
    );

    const { unmount } = render(
      <AIFeedbackComponent
        accessToken="tok-1"
        reportTarget={{ type: 'roadmap_content', id: 'rm-99' }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /report issue/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(
      within(dialog).getByRole('button', { name: /Submit report/i }),
    );

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    const reportedBadge = screen.getByText('Reported').closest('[aria-disabled]');
    expect(reportedBadge).toHaveAttribute('aria-disabled', 'true');
    expect(reportedBadge).toHaveClass(
      'border-red-200',
      'bg-red-50',
      'text-red-700',
    );
    const toast = await screen.findByTestId('toast-container');
    expect(toast).toHaveTextContent(/Already reported/i);
    expect(
      screen.queryByRole('button', { name: /report issue/i }),
    ).not.toBeInTheDocument();

    // Refresh / remount -> MUST stay "Reported", NEVER revert to "Report issue"
    unmount();
    render(
      <AIFeedbackComponent
        accessToken="tok-1"
        reportTarget={{ type: 'roadmap_content', id: 'rm-99' }}
      />,
    );
    expect(
      screen.getByText('Reported').closest('[aria-disabled]'),
    ).toHaveAttribute('aria-disabled', 'true');
    expect(
      screen.queryByRole('button', { name: /report issue/i }),
    ).not.toBeInTheDocument();
  });

  it('ignores stale in-flight rating and report responses when accessToken switches mid-request', async () => {
    let resolveStaleRating!: (res: RatingResponseDTO) => void;
    let resolveStaleReport!: (res: ReportResponseDTO) => void;

    vi.mocked(submitRating).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveStaleRating = resolve;
      }),
    );
    vi.mocked(submitReport).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveStaleReport = resolve;
      }),
    );

    const onRated = vi.fn();
    const onReported = vi.fn();

    const { rerender } = render(
      <AIFeedbackComponent
        accessToken="token-old"
        ratingTarget={{ type: 'topic_content', id: 'top-1' }}
        reportTarget={{ type: 'topic_content', id: 'top-1' }}
        onRated={onRated}
        onReported={onReported}
      />,
    );

    // Start in-flight rating + report on token-old
    fireEvent.click(screen.getByRole('radio', { name: '5 stars' }));
    fireEvent.click(screen.getByRole('button', { name: /Submit rating/i }));

    fireEvent.click(screen.getByRole('button', { name: /report issue/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(
      within(dialog).getByRole('button', { name: /Submit report/i }),
    );

    // Session switches to token-new before old promises settle
    rerender(
      <AIFeedbackComponent
        accessToken="token-new"
        ratingTarget={{ type: 'topic_content', id: 'top-1' }}
        reportTarget={{ type: 'topic_content', id: 'top-1' }}
        onRated={onRated}
        onReported={onReported}
      />,
    );

    await act(async () => {
      resolveStaleRating({
        target_type: 'topic_content',
        target_id: 'top-1',
        score: 5,
      });
      resolveStaleReport({
        report_id: 'rep-stale',
        status: 'received',
      });
      await Promise.resolve();
    });

    // Fresh token-new UI remains clean: not saved, not reported, no toast, callbacks not fired
    expect(onRated).not.toHaveBeenCalled();
    expect(onReported).not.toHaveBeenCalled();
    expect(screen.queryByTestId('ai-feedback-score')).not.toBeInTheDocument();
    expect(screen.queryByTestId('toast-container')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /report issue/i }),
    ).toBeInTheDocument();
  });

  it('persists accepted rating across a same-user token refresh mid-flight and guards target-switch toast/callbacks + retires pending state', async () => {
    // 1. Same-user token refresh mid-flight still persists accepted rating under shared user sub
    const jwt1 = makeFakeJwt('same-user-sub', 'r1');
    const jwt2 = makeFakeJwt('same-user-sub', 'r2');
    expect(jwt2).not.toBe(jwt1);

    let resolveSameUserRating!: (res: RatingResponseDTO) => void;
    vi.mocked(submitRating).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSameUserRating = resolve;
      }),
    );

    const onRatedSameUser = vi.fn();
    const { rerender, unmount } = render(
      <AIFeedbackComponent
        accessToken={jwt1}
        ratingTarget={{ type: 'topic_content', id: 'top-refresh-inflight' }}
        onRated={onRatedSameUser}
      />,
    );

    fireEvent.click(screen.getByRole('radio', { name: '5 stars' }));
    fireEvent.click(screen.getByRole('button', { name: /Submit rating/i }));

    // Same user refreshes token before request settles
    rerender(
      <AIFeedbackComponent
        accessToken={jwt2}
        ratingTarget={{ type: 'topic_content', id: 'top-refresh-inflight' }}
        onRated={onRatedSameUser}
      />,
    );

    await act(async () => {
      resolveSameUserRating({
        target_type: 'topic_content',
        target_id: 'top-refresh-inflight',
        score: 5,
      });
      await Promise.resolve();
    });

    // Persisted via shared sub -> visible immediately under jwt2 (and after remount) without firing stale callback
    expect(onRatedSameUser).not.toHaveBeenCalled();
    expect(screen.getByTestId('ai-feedback-score')).toHaveTextContent('(5)');
    unmount();

    // 2. Target switch under same token: stale A completion must NOT clobber B's toast or fire onRated for B
    let resolveTargetA!: (res: RatingResponseDTO) => void;
    vi.mocked(submitRating)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveTargetA = resolve;
        }),
      )
      .mockResolvedValueOnce({
        target_type: 'topic_content',
        target_id: 'top-B',
        score: 3,
      });

    const onRatedTarget = vi.fn();
    const view2 = render(
      <AIFeedbackComponent
        accessToken="tok-shared"
        ratingTarget={{ type: 'topic_content', id: 'top-A' }}
        onRated={onRatedTarget}
      />,
    );

    fireEvent.click(screen.getByRole('radio', { name: '4 stars' }));
    fireEvent.click(screen.getByRole('button', { name: /Submit rating/i }));

    // Switch to target B and submit rating 3
    view2.rerender(
      <AIFeedbackComponent
        accessToken="tok-shared"
        ratingTarget={{ type: 'topic_content', id: 'top-B' }}
        onRated={onRatedTarget}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: '3 stars' }));
    fireEvent.click(screen.getByRole('button', { name: /Submit rating/i }));

    expect(await screen.findByTestId('toast-container')).toHaveTextContent(
      '3/5',
    );
    expect(onRatedTarget).toHaveBeenCalledTimes(1);
    expect(onRatedTarget).toHaveBeenLastCalledWith(3);

    // Now target A settles late -> B's toast remains intact and onRated is NOT called again
    await act(async () => {
      resolveTargetA({
        target_type: 'topic_content',
        target_id: 'top-A',
        score: 4,
      });
      await Promise.resolve();
    });
    expect(screen.getByTestId('toast-container')).toHaveTextContent('3/5');
    expect(onRatedTarget).toHaveBeenCalledTimes(1);
    view2.unmount();

    // 3. Returning to token A after its report failed while switched to token B must NOT restore a stuck modal
    let rejectTokenAReport!: (err: Error) => void;
    vi.mocked(submitReport).mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectTokenAReport = reject;
      }),
    );

    const view3 = render(
      <AIFeedbackComponent
        accessToken="tok-A-fail"
        reportTarget={{ type: 'quiz_question', id: 'qq-retire' }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /report issue/i }));
    const dialogA = await screen.findByRole('dialog');
    fireEvent.click(
      within(dialogA).getByRole('button', { name: /Submit report/i }),
    );

    // Switch to token B while report is in flight, then reject token A's request
    view3.rerender(
      <AIFeedbackComponent
        accessToken="tok-B-other"
        reportTarget={{ type: 'quiz_question', id: 'qq-retire' }}
      />,
    );
    await act(async () => {
      rejectTokenAReport(new ApiError(500, 'Boom', 'INTERNAL_ERROR'));
      await Promise.resolve();
    });

    // Switch back to token A -> modal MUST NOT reopen stuck in submitting state
    view3.rerender(
      <AIFeedbackComponent
        accessToken="tok-A-fail"
        reportTarget={{ type: 'quiz_question', id: 'qq-retire' }}
      />,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /report issue/i }),
    ).not.toBeDisabled();
    view3.unmount();

    // 4. Delayed older rating (2 stars) arriving AFTER newer rating (5 stars) across token refresh MUST NOT overwrite 5
    const seqJwt1 = makeFakeJwt('seq-user', 's1');
    const seqJwt2 = makeFakeJwt('seq-user', 's2');
    let resolveOld2!: (res: RatingResponseDTO) => void;
    vi.mocked(submitRating)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveOld2 = resolve;
        }),
      )
      .mockResolvedValueOnce({
        target_type: 'topic_content',
        target_id: 'top-seq',
        score: 5,
      });

    const view4 = render(
      <AIFeedbackComponent
        accessToken={seqJwt1}
        ratingTarget={{ type: 'topic_content', id: 'top-seq' }}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: '2 stars' }));
    fireEvent.click(screen.getByRole('button', { name: /Submit rating/i }));

    // Refresh token & submit 5 stars (completes FIRST)
    view4.rerender(
      <AIFeedbackComponent
        accessToken={seqJwt2}
        ratingTarget={{ type: 'topic_content', id: 'top-seq' }}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: '5 stars' }));
    fireEvent.click(screen.getByRole('button', { name: /Submit rating/i }));
    expect(await screen.findByTestId('ai-feedback-score')).toHaveTextContent(
      '(5)',
    );

    // Delayed 2-star response settles LAST -> storage MUST keep 5 stars
    await act(async () => {
      resolveOld2({
        target_type: 'topic_content',
        target_id: 'top-seq',
        score: 2,
      });
      await Promise.resolve();
    });
    view4.unmount();

    const view4Remount = render(
      <AIFeedbackComponent
        accessToken={seqJwt2}
        ratingTarget={{ type: 'topic_content', id: 'top-seq' }}
      />,
    );
    expect(screen.getByTestId('ai-feedback-score')).toHaveTextContent('(5)');
    view4Remount.unmount();

    // 5. Non-duplicate 409 STALE_VERSION keeps modal open with error and does NOT mark Reported
    vi.mocked(submitReport).mockRejectedValueOnce(
      new ApiError(409, 'Version conflict', 'STALE_VERSION', 'req-409-other'),
    );
    const conflictView = render(
      <AIFeedbackComponent
        accessToken="tok-other-409"
        reportTarget={{ type: 'roadmap_content', id: 'rm-other-409' }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /report issue/i }));
    const conflictDialog = await screen.findByRole('dialog');
    fireEvent.click(
      within(conflictDialog).getByRole('button', { name: /Submit report/i }),
    );
    expect(await within(conflictDialog).findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('Reported')).not.toBeInTheDocument();
    conflictView.unmount();
  });

  it('keeps dialog closed before and after account A pending report settles on A -> B -> A switch', async () => {
    let resolveReportA!: (res: ReportResponseDTO) => void;
    vi.mocked(submitReport).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveReportA = resolve;
      }),
    );

    const view = render(
      <AIFeedbackComponent
        accessToken="tok-return-A"
        reportTarget={{ type: 'quiz_question', id: 'qq-return-aba' }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /report issue/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(
      within(dialog).getByRole('button', { name: /Submit report/i }),
    );

    // Switch A -> B -> A while A's request is still pending
    view.rerender(
      <AIFeedbackComponent
        accessToken="tok-return-B"
        reportTarget={{ type: 'quiz_question', id: 'qq-return-aba' }}
      />,
    );
    view.rerender(
      <AIFeedbackComponent
        accessToken="tok-return-A"
        reportTarget={{ type: 'quiz_question', id: 'qq-return-aba' }}
      />,
    );

    // Before A's original request settles, dialog stays closed
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // After A's original request settles, dialog still stays closed (and Reported persists via storage)
    await act(async () => {
      resolveReportA({ report_id: 'rep-aba-1', status: 'received' });
      await Promise.resolve();
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(
      screen.getByText('Reported').closest('[aria-disabled]'),
    ).toHaveAttribute('aria-disabled', 'true');
  });

  it('passes finite timeoutMs on report submission, recovers draft on timeout, and reconciles 409 REPORT_ALREADY_SUBMITTED on retry', async () => {
    vi.mocked(submitReport)
      .mockRejectedValueOnce(
        new NetworkError('Request timed out or was aborted. Please try again.'),
      )
      .mockRejectedValueOnce(
        new ApiError(
          409,
          'Duplicate report',
          'REPORT_ALREADY_SUBMITTED',
          'req-retry-409',
        ),
      );

    render(
      <AIFeedbackComponent
        accessToken="tok-timeout"
        reportTarget={{ type: 'topic_content', id: 'top-timeout-1' }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /report issue/i }));
    const dialog = await screen.findByRole('dialog');
    const outdatedRadio = within(dialog).getByRole('radio', {
      name: /Outdated content/i,
    });
    fireEvent.click(outdatedRadio);
    const detailsBox = within(dialog).getByLabelText(/Additional details/i);
    fireEvent.change(detailsBox, {
      target: { value: 'Preserved report draft after timeout' },
    });

    fireEvent.click(
      within(dialog).getByRole('button', { name: /Submit report/i }),
    );

    expect(submitReport).toHaveBeenCalledWith(
      'tok-timeout',
      {
        target_type: 'topic_content',
        target_id: 'top-timeout-1',
        reason: 'outdated',
        comment: 'Preserved report draft after timeout',
      },
      { timeoutMs: 15_000 },
    );

    // Timeout clears submitting, keeps reason + comment draft intact, and leaves modal recoverable
    expect(await within(dialog).findByRole('alert')).toBeInTheDocument();
    expect(outdatedRadio).toBeChecked();
    expect(detailsBox).toHaveValue('Preserved report draft after timeout');
    const retryBtn = within(dialog).getByRole('button', {
      name: /Submit report/i,
    });
    expect(retryBtn).toBeEnabled();
    expect(
      within(dialog).getByRole('button', { name: 'Cancel' }),
    ).toBeEnabled();

    // Retry returns 409 REPORT_ALREADY_SUBMITTED -> reconciles cleanly to Reported badge
    fireEvent.click(retryBtn);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(
      screen.getByText('Reported').closest('[aria-disabled]'),
    ).toHaveAttribute('aria-disabled', 'true');
  });

  it('clears pending state without toast or onRated when an outdated sibling rating response is superseded', async () => {
    let resolveSlowA!: (res: RatingResponseDTO) => void;
    vi.mocked(submitRating)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveSlowA = resolve;
        }),
      )
      .mockResolvedValueOnce({
        target_type: 'topic_content',
        target_id: 'top-superseded',
        score: 5,
      });

    const onRatedA = vi.fn();
    const onRatedB = vi.fn();

    render(
      <div>
        <div data-testid="sup-a">
          <AIFeedbackComponent
            accessToken="tok-sup"
            ratingTarget={{ type: 'topic_content', id: 'top-superseded' }}
            onRated={onRatedA}
          />
        </div>
        <div data-testid="sup-b">
          <AIFeedbackComponent
            accessToken="tok-sup"
            ratingTarget={{ type: 'topic_content', id: 'top-superseded' }}
            onRated={onRatedB}
          />
        </div>
      </div>,
    );

    const instA = screen.getByTestId('sup-a');
    const instB = screen.getByTestId('sup-b');

    // Instance A starts slower 2-star submit (writeSeq N)
    fireEvent.click(within(instA).getByRole('radio', { name: '2 stars' }));
    fireEvent.click(
      within(instA).getByRole('button', { name: /Submit rating/i }),
    );

    // Instance B starts & finishes newer 5-star submit (writeSeq N+1)
    fireEvent.click(within(instB).getByRole('radio', { name: '5 stars' }));
    fireEvent.click(
      within(instB).getByRole('button', { name: /Submit rating/i }),
    );
    expect(
      await within(instB).findByTestId('ai-feedback-score'),
    ).toHaveTextContent('(5)');
    expect(onRatedB).toHaveBeenCalledTimes(1);
    expect(onRatedB).toHaveBeenCalledWith(5);

    // Now Instance A's older 2-star request resolves -> superseded!
    await act(async () => {
      resolveSlowA({
        target_type: 'topic_content',
        target_id: 'top-superseded',
        score: 2,
      });
      await Promise.resolve();
    });

    // Instance A clears pending state (stars re-enabled) WITHOUT calling onRatedA or emitting a 2/5 toast
    expect(onRatedA).not.toHaveBeenCalled();
    expect(within(instA).getByTestId('ai-feedback-score')).toHaveTextContent(
      '(5)',
    );
    expect(within(instA).getByRole('radio', { name: '5 stars' })).toBeEnabled();
    expect(
      within(instA).queryByTestId('toast-container'),
    ).not.toBeInTheDocument();
  });

  it('keeps unsent rating comment form open when a sibling saves while untouched siblings switch to saved preview', async () => {
    vi.mocked(submitRating).mockResolvedValueOnce({
      target_type: 'topic_content',
      target_id: 'top-draft-keep',
      score: 4,
    });

    render(
      <div>
        <div data-testid="draft-typing">
          <AIFeedbackComponent
            accessToken="tok-draft"
            ratingTarget={{ type: 'topic_content', id: 'top-draft-keep' }}
          />
        </div>
        <div data-testid="draft-untouched">
          <AIFeedbackComponent
            accessToken="tok-draft"
            ratingTarget={{ type: 'topic_content', id: 'top-draft-keep' }}
          />
        </div>
        <div data-testid="draft-saver">
          <AIFeedbackComponent
            accessToken="tok-draft"
            ratingTarget={{ type: 'topic_content', id: 'top-draft-keep' }}
          />
        </div>
      </div>,
    );

    const typingInst = screen.getByTestId('draft-typing');
    const untouchedInst = screen.getByTestId('draft-untouched');
    const saverInst = screen.getByTestId('draft-saver');

    // User types comment in typingInst WITHOUT clicking a star yet
    fireEvent.change(within(typingInst).getByLabelText(/Rating comment/i), {
      target: { value: 'Work-in-progress comment before clicking star' },
    });

    // Sibling saverInst submits a rating + review
    fireEvent.click(within(saverInst).getByRole('radio', { name: '4 stars' }));
    fireEvent.change(within(saverInst).getByLabelText(/Rating comment/i), {
      target: { value: 'Sibling saved review' },
    });
    fireEvent.click(
      within(saverInst).getByRole('button', { name: /Submit rating/i }),
    );

    expect(
      await within(saverInst).findByTestId('ai-feedback-score'),
    ).toHaveTextContent('(4)');

    // Typing instance keeps its form open and unsent draft intact
    expect(within(typingInst).getByLabelText(/Rating comment/i)).toHaveValue(
      'Work-in-progress comment before clicking star',
    );

    // Untouched sibling switches cleanly to saved preview
    expect(
      within(untouchedInst).queryByLabelText(/Rating comment/i),
    ).not.toBeInTheDocument();
    expect(
      within(untouchedInst).getByTestId('ai-feedback-review-preview'),
    ).toHaveTextContent('Sibling saved review');
  });

  it('retains accepted rating and report via in-memory overlay when localStorage.setItem fails and clears overlay on recovery or external storage event', async () => {
    const setItemSpy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });

    vi.mocked(submitRating)
      .mockResolvedValueOnce({
        target_type: 'topic_content',
        target_id: 'top-overlay',
        score: 4,
      })
      .mockResolvedValueOnce({
        target_type: 'topic_content',
        target_id: 'top-overlay',
        score: 5,
      });
    vi.mocked(submitReport).mockResolvedValueOnce({
      report_id: 'rep-overlay-1',
      status: 'received',
    });

    try {
      const { unmount } = render(
        <AIFeedbackComponent
          accessToken="tok-overlay"
          ratingTarget={{ type: 'topic_content', id: 'top-overlay' }}
          reportTarget={{ type: 'topic_content', id: 'top-overlay' }}
        />,
      );

      // Rating succeeds even though localStorage.setItem throws -> overlay keeps (4) & review
      fireEvent.click(screen.getByRole('radio', { name: '4 stars' }));
      fireEvent.change(screen.getByLabelText(/Rating comment/i), {
        target: { value: 'Overlay saved comment' },
      });
      fireEvent.click(screen.getByRole('button', { name: /Submit rating/i }));
      expect(await screen.findByTestId('ai-feedback-score')).toHaveTextContent(
        '(4)',
      );
      expect(
        screen.getByTestId('ai-feedback-review-preview'),
      ).toHaveTextContent('Overlay saved comment');

      // Report succeeds even though localStorage.setItem throws -> overlay keeps Reported
      fireEvent.click(screen.getByRole('button', { name: /report issue/i }));
      const dialog = await screen.findByRole('dialog');
      fireEvent.click(
        within(dialog).getByRole('button', { name: /Submit report/i }),
      );
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
      expect(
        screen.getByText('Reported').closest('[aria-disabled]'),
      ).toHaveAttribute('aria-disabled', 'true');

      // Remount still reads in-memory overlay (never reverts to empty localStorage)
      unmount();
      render(
        <AIFeedbackComponent
          accessToken="tok-overlay"
          ratingTarget={{ type: 'topic_content', id: 'top-overlay' }}
          reportTarget={{ type: 'topic_content', id: 'top-overlay' }}
        />,
      );
      expect(screen.getByTestId('ai-feedback-score')).toHaveTextContent('(4)');
      expect(
        screen.getByText('Reported').closest('[aria-disabled]'),
      ).toHaveAttribute('aria-disabled', 'true');

      // External storage event supersedes overlay
      setItemSpy.mockRestore();
      const storageKey = buildFeedbackStorageKey(
        'tok-overlay',
        'topic_content',
        'top-overlay',
      )!;
      const externalPayload = JSON.stringify({
        rating: { score: 3, comment: 'External tab review' },
        report: { reported: true, reason: 'unclear' },
      });
      window.localStorage.setItem(storageKey, externalPayload);
      act(() => {
        window.dispatchEvent(
          new StorageEvent('storage', {
            key: storageKey,
            newValue: externalPayload,
          }),
        );
      });
      expect(screen.getByTestId('ai-feedback-score')).toHaveTextContent('(3)');
      expect(
        screen.getByTestId('ai-feedback-review-preview'),
      ).toHaveTextContent('External tab review');

      // Subsequent durable write succeeds and updates localStorage cleanly
      fireEvent.click(screen.getByRole('radio', { name: '5 stars' }));
      fireEvent.click(screen.getByRole('button', { name: /Update rating/i }));
      expect(await screen.findByTestId('ai-feedback-score')).toHaveTextContent(
        '(5)',
      );
      expect(window.localStorage.getItem(storageKey)).toContain('"score":5');
    } finally {
      setItemSpy.mockRestore();
    }
  });

  it('follows standard WAI-ARIA radiogroup arrow directions (ArrowRight/ArrowDown next, ArrowLeft/ArrowUp previous with wraparound)', () => {
    render(
      <AIFeedbackComponent
        accessToken="tok-aria"
        ratingTarget={{ type: 'topic_content', id: 'top-aria' }}
      />,
    );

    const star1 = screen.getByRole('radio', { name: '1 star' });
    const star2 = screen.getByRole('radio', { name: '2 stars' });
    const star3 = screen.getByRole('radio', { name: '3 stars' });
    const star5 = screen.getByRole('radio', { name: '5 stars' });

    // ArrowRight & ArrowDown advance
    fireEvent.keyDown(star1, { key: 'ArrowRight' });
    expect(star2).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(star2, { key: 'ArrowDown' });
    expect(star3).toHaveAttribute('aria-checked', 'true');

    // ArrowUp & ArrowLeft decrement
    fireEvent.keyDown(star3, { key: 'ArrowUp' });
    expect(star2).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(star2, { key: 'ArrowLeft' });
    expect(star1).toHaveAttribute('aria-checked', 'true');

    // Wraparound: ArrowUp on 1 -> 5; ArrowDown on 5 -> 1
    fireEvent.keyDown(star1, { key: 'ArrowUp' });
    expect(star5).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(star5, { key: 'ArrowDown' });
    expect(star1).toHaveAttribute('aria-checked', 'true');
  });

  it('synchronizes accepted rating & comment across sibling mounted instances while preserving active drafts, and never lets a later failed submit poison an earlier accepted rating', async () => {
    // 1. Dual mounted instances for the same target stay coherent when instance B saves a newer rating/comment
    vi.mocked(submitRating)
      .mockResolvedValueOnce({
        target_type: 'technology_update',
        target_id: 'tu-sync-1',
        score: 3,
      })
      .mockResolvedValueOnce({
        target_type: 'technology_update',
        target_id: 'tu-sync-1',
        score: 5,
      });

    const dualView = render(
      <div>
        <div data-testid="instance-a">
          <AIFeedbackComponent
            accessToken="tok-sync"
            ratingTarget={{ type: 'technology_update', id: 'tu-sync-1' }}
            compact
          />
        </div>
        <div data-testid="instance-b">
          <AIFeedbackComponent
            accessToken="tok-sync"
            ratingTarget={{ type: 'technology_update', id: 'tu-sync-1' }}
            compact
          />
        </div>
      </div>,
    );

    const instA = screen.getByTestId('instance-a');
    const instB = screen.getByTestId('instance-b');

    // Instance A saves 3 stars + initial comment
    fireEvent.click(within(instA).getByRole('radio', { name: '3 stars' }));
    fireEvent.change(within(instA).getByLabelText(/Rating comment/i), {
      target: { value: 'Initial review from A' },
    });
    fireEvent.click(
      within(instA).getByRole('button', { name: /Submit rating/i }),
    );
    expect(
      await within(instA).findByTestId('ai-feedback-score'),
    ).toHaveTextContent('(3)');
    expect(within(instB).getByTestId('ai-feedback-score')).toHaveTextContent(
      '(3)',
    );

    // Instance B updates to 5 stars + newer comment -> idle Instance A immediately reflects 5 stars + new comment!
    fireEvent.click(within(instB).getByRole('radio', { name: '5 stars' }));
    fireEvent.change(within(instB).getByLabelText(/Rating comment/i), {
      target: { value: 'Updated review from B' },
    });
    fireEvent.click(
      within(instB).getByRole('button', { name: /Update rating/i }),
    );
    await waitFor(() => {
      expect(within(instA).getByTestId('ai-feedback-score')).toHaveTextContent(
        '(5)',
      );
    });
    expect(within(instA).getByRole('radio', { name: '5 stars' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(
      within(instA).getByTestId('ai-feedback-review-preview'),
    ).toHaveTextContent('Updated review from B');

    // Active unsaved draft in A is preserved even while B submits another rating
    vi.mocked(submitRating).mockResolvedValueOnce({
      target_type: 'technology_update',
      target_id: 'tu-sync-1',
      score: 4,
    });
    fireEvent.click(within(instA).getByRole('radio', { name: '2 stars' }));
    fireEvent.change(within(instA).getByLabelText(/Rating comment/i), {
      target: { value: 'Unsaved draft in A' },
    });
    fireEvent.click(within(instB).getByRole('radio', { name: '4 stars' }));
    fireEvent.click(
      within(instB).getByRole('button', { name: /Update rating/i }),
    );
    await waitFor(() => {
      expect(within(instA).getByTestId('ai-feedback-score')).toHaveTextContent(
        '(4)',
      );
    });
    expect(within(instA).getByRole('radio', { name: '2 stars' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(within(instA).getByLabelText(/Rating comment/i)).toHaveValue(
      'Unsaved draft in A',
    );
    dualView.unmount();

    // 2. Request A starts (seq 1), token refreshes, Request B starts (seq 2) and FAILS -> A's 200 MUST still persist!
    const wmJwt1 = makeFakeJwt('wm-user', 'w1');
    const wmJwt2 = makeFakeJwt('wm-user', 'w2');
    let resolveA!: (res: RatingResponseDTO) => void;
    vi.mocked(submitRating)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveA = resolve;
        }),
      )
      .mockRejectedValueOnce(
        new ApiError(503, 'Temporary failure', 'SERVICE_UNAVAILABLE'),
      );

    const wmView = render(
      <AIFeedbackComponent
        accessToken={wmJwt1}
        ratingTarget={{ type: 'topic_content', id: 'top-watermark' }}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: '4 stars' }));
    fireEvent.click(screen.getByRole('button', { name: /Submit rating/i }));

    // Token refreshes and Request B fails
    wmView.rerender(
      <AIFeedbackComponent
        accessToken={wmJwt2}
        ratingTarget={{ type: 'topic_content', id: 'top-watermark' }}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: '2 stars' }));
    fireEvent.click(screen.getByRole('button', { name: /Submit rating/i }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    // Now Request A succeeds -> B's failure MUST NOT have poisoned A's accepted write!
    await act(async () => {
      resolveA({
        target_type: 'topic_content',
        target_id: 'top-watermark',
        score: 4,
      });
      await Promise.resolve();
    });
    expect(screen.getByTestId('ai-feedback-score')).toHaveTextContent('(4)');
    wmView.unmount();
  });
});
