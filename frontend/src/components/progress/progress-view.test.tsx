import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getProgress,
  getProgressHistory,
  getSkillProgressDetail,
  listRoadmaps,
  type ProgressHistoryItemDTO,
  type ProgressResponseDTO,
} from '@/lib/api/client';
import { ProgressView } from './progress-view';

vi.mock('@/lib/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/client')>(
    '@/lib/api/client',
  );
  return {
    ...actual,
    getProgress: vi.fn(),
    getProgressHistory: vi.fn(),
    getSkillProgressDetail: vi.fn(),
    listRoadmaps: vi.fn(),
  };
});

const SAMPLE_PROGRESS: ProgressResponseDTO = {
  roadmap_id: 'rm-1',
  career_level: 'mid',
  roadmap_progress: {
    items_total: 10,
    items_completed: 4,
  },
  skills: [
    {
      skill_id: 'skill-sql',
      name: 'PostgreSQL Indexing',
      career_level: 'mid',
      learning_state: 'practicing',
      shared_with_roadmap_ids: ['rm-2'],
      weak_area: false,
      last_evidence_at: '2026-11-22T10:00:00.000Z',
      state_reason:
        'Strong initial practice performance recorded; repeated practice required for proficient state.',
    },
    {
      skill_id: 'skill-tx',
      name: 'Transaction Isolation',
      career_level: 'mid',
      learning_state: 'learning',
      shared_with_roadmap_ids: [],
      weak_area: true,
      last_evidence_at: '2026-11-22T09:00:00.000Z',
      state_reason: 'Initial practice attempt completed.',
    },
  ],
  weak_areas: [
    {
      skill_id: 'skill-tx',
      name: 'Transaction Isolation',
      reason: 'Most recent practice attempt rated needs_work',
    },
  ],
};

const SAMPLE_HISTORY: ProgressHistoryItemDTO[] = [
  {
    id: 'hist-1',
    occurred_at: '2026-11-22T10:00:00.000Z',
    skill_id: 'skill-sql',
    career_level: 'mid',
    event: 'state_change',
    from_state: 'not_started',
    to_state: 'practicing',
    reason: 'Completed first quiz attempt at mid level.',
    source: 'quiz_attempt',
    source_id: 'ev-1',
    source_attempt_id: 'att-123',
  },
  {
    id: 'hist-1-dup-evidence',
    occurred_at: '2026-11-22T10:00:00.000Z',
    skill_id: 'skill-sql',
    career_level: 'mid',
    event: 'evidence_added',
    from_state: 'not_started',
    to_state: 'practicing',
    reason: 'Completed first quiz attempt at mid level.',
    source: 'quiz_attempt',
    source_id: 'ev-1',
    source_attempt_id: 'att-123',
  },
];

describe('ProgressView (Screen 19 — EP-G01, EP-G02, EP-G03, tabs, filters & SkillDetailDrawer)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listRoadmaps).mockResolvedValue({
      items: [
        {
          id: 'rm-1',
          career_goal_id: 'g-1',
          canonical_role_id: 'r-1',
          role_name: 'Backend Engineer',
          target_level: 'mid',
          status: 'locked',
          is_focus: true,
          current_version_id: 'v-1',
          current_version_no: 1,
          draft_version_no: null,
          has_open_draft: false,
          has_open_merge: false,
          has_daily_plan: true,
          stale: false,
          stale_draft: false,
          locked_at: '2026-11-20T00:00:00.000Z',
          archived_at: null,
          created_at: '2026-11-20T00:00:00.000Z',
          updated_at: '2026-11-20T00:00:00.000Z',
        },
      ],
      meta: { limit: 20, next_cursor: null },
    });
    vi.mocked(getProgress).mockResolvedValue({
      progress: SAMPLE_PROGRESS,
      meta: { limit: 20, next_cursor: null },
    });
    vi.mocked(getProgressHistory).mockResolvedValue({
      items: SAMPLE_HISTORY,
      meta: { limit: 20, next_cursor: null },
    });
    vi.mocked(getSkillProgressDetail).mockResolvedValue({
      skill_id: 'skill-sql',
      name: 'PostgreSQL Indexing',
      levels: [
        {
          career_level: 'mid',
          learning_state: 'practicing',
          state_reason: 'Recorded 1 quiz attempt and 1 AI Practice Review.',
          last_evidence_at: '2026-11-22T10:00:00.000Z',
          evidence_summary: {
            count: 2,
            quiz_attempts: 1,
            practice_reviews: 1,
            retry_improved: true,
          },
          roadmap_requirements: [
            {
              roadmap_id: 'rm-1',
              required_depth: 'Composite & partial index design',
            },
          ],
        },
      ],
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders Overview, Shared Skills, Weak Areas, and History tabs with keyboard navigation and opens SkillDetailDrawer (EP-G02)', async () => {
    render(
      <ProgressView
        accessToken="tok-1"
        initialProgress={SAMPLE_PROGRESS}
        initialHistory={SAMPLE_HISTORY}
      />,
    );

    expect(
      screen.getByRole('heading', { name: /Skill Progress & Topic Mastery/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /Today's Learning/i }),
    ).toBeInTheDocument();
    expect(screen.getByText('PostgreSQL Indexing')).toBeInTheDocument();
    expect(screen.getByText('Transaction Isolation')).toBeInTheDocument();
    expect(document.body.textContent?.toLowerCase()).not.toContain('job ready');

    // Open SkillDetailDrawer (EP-G02)
    const inspectButtons = screen.getAllByRole('button', {
      name: /Inspect Evidence/i,
    });
    fireEvent.click(inspectButtons[0]!);

    const dialog = await screen.findByRole('dialog');
    expect(
      await within(dialog).findByText(
        /Composite & partial index design/i,
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/Improved on retry/i)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));

    // Keyboard arrow navigation across tabs: Overview -> Shared Skills -> Weak Areas -> History
    const overviewTab = screen.getByRole('tab', { name: /Overview/i });
    fireEvent.keyDown(overviewTab, { key: 'ArrowRight' });
    expect(
      screen.getByRole('tab', { name: /Shared Skills/i }),
    ).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('PostgreSQL Indexing')).toBeInTheDocument();
    expect(screen.queryByText('Transaction Isolation')).not.toBeInTheDocument();

    const sharedTab = screen.getByRole('tab', { name: /Shared Skills/i });
    fireEvent.keyDown(sharedTab, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: /Weak Areas/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(
      screen.getByText(/Most recent practice attempt rated needs_work/i),
    ).toBeInTheDocument();

    const weakTab = screen.getByRole('tab', { name: /Weak Areas/i });
    fireEvent.keyDown(weakTab, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: /History/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByText('Mastery State Updated')).toBeInTheDocument();
    expect(
      screen.queryByText('Practice Evidence Added'),
    ).not.toBeInTheDocument();
    const quizLink = screen.getByRole('link', { name: /View Quiz Attempt/i });
    expect(quizLink).toHaveAttribute('href', '/quiz/att-123');
  });

  it('filters EP-G01 by mastery state and supports R16 Clear Filters recovery when empty', async () => {
    vi.mocked(getProgress).mockResolvedValueOnce({
      progress: {
        ...SAMPLE_PROGRESS,
        skills: [],
      },
      meta: { limit: 20, next_cursor: null },
    });

    render(
      <ProgressView
        accessToken="tok-1"
        initialProgress={SAMPLE_PROGRESS}
        initialHistory={SAMPLE_HISTORY}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Filter by mastery state/i), {
      target: { value: 'proficient' },
    });

    await waitFor(() => {
      expect(getProgress).toHaveBeenCalledWith(
        'tok-1',
        expect.objectContaining({ learning_state: 'proficient' }),
        expect.any(Object),
      );
      expect(
        screen.getByRole('heading', {
          name: /No skills match your active filters/i,
        }),
      ).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getAllByRole('button', { name: /Clear Filters/i })[0]!,
    );
    expect(screen.getByText('PostgreSQL Indexing')).toBeInTheDocument();
  });

  it('shows Weak Areas error + Try Again, History retry & Load More preservation, and Shared Skills Load More when nextCursor exists', async () => {
    vi.mocked(getProgress).mockRejectedValueOnce(
      new Error('Skills page 2 outage'),
    );
    vi.mocked(getProgressHistory).mockRejectedValueOnce(
      new Error('History pagination failure'),
    );

    render(
      <ProgressView
        accessToken="tok-1"
        initialProgress={{
          ...SAMPLE_PROGRESS,
          skills: [
            {
              ...SAMPLE_PROGRESS.skills[1]!,
              shared_with_roadmap_ids: [],
            },
          ],
        }}
        initialProgressNextCursor="cursor-skills-2"
        initialHistory={SAMPLE_HISTORY}
        initialHistoryNextCursor="cursor-hist-2"
      />,
    );

    // 1. Overview page-2 failure keeps page-1 skill card visible with inline error + retry button
    fireEvent.click(screen.getByRole('button', { name: /Load More Skills/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByText('Transaction Isolation')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Retry Load More Skills/i }),
    ).toBeInTheDocument();

    // 2. Shared Skills shows Load More Skills when nextCursor is present even with 0 shared skills on page 1
    fireEvent.click(screen.getByRole('tab', { name: /Shared Skills/i }));
    expect(
      screen.getByRole('button', { name: /Retry Load More Skills/i }),
    ).toBeInTheDocument();

    // 3. History Load More error preserves already-loaded cards
    fireEvent.click(screen.getByRole('tab', { name: /History/i }));
    expect(screen.getByText('Mastery State Updated')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Load More History/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByText('Mastery State Updated')).toBeInTheDocument();
  });

  it('recovers from Weak Areas error + Try Again and History initial load failure + Retry independently', async () => {
    vi.mocked(getProgress)
      .mockRejectedValueOnce(new Error('Temporary progress outage'))
      .mockResolvedValue({
        progress: SAMPLE_PROGRESS,
        meta: { limit: 20, next_cursor: null },
      });
    vi.mocked(getProgressHistory)
      .mockRejectedValueOnce(new Error('Temporary history outage'))
      .mockResolvedValue({
        items: SAMPLE_HISTORY,
        meta: { limit: 20, next_cursor: null },
      });

    render(<ProgressView accessToken="tok-1" />);

    // 1. Weak Areas error + Try Again recovery (does NOT reset/reload History)
    fireEvent.click(screen.getByRole('tab', { name: /Weak Areas/i }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(
      screen.queryByText(/No weak areas flagged right now/i),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Try Again/i }));
    expect(
      await screen.findByText(/Most recent practice attempt rated needs_work/i),
    ).toBeInTheDocument();
    expect(getProgressHistory).toHaveBeenCalledTimes(1);

    // 2. History initial failure shows Retry button; clicking Retry recovers cleanly
    fireEvent.click(screen.getByRole('tab', { name: /History/i }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Retry$/i }));
    expect(
      await screen.findByText('Mastery State Updated'),
    ).toBeInTheDocument();
    expect(getProgressHistory).toHaveBeenCalledTimes(2);
  });

  it('clears stale skillsPaginationErrorState after a filter roundtrip when first-page getProgress succeeds again', async () => {
    vi.mocked(getProgress)
      // 1. Initial page-1 load (unfiltered) with next_cursor
      .mockResolvedValueOnce({
        progress: SAMPLE_PROGRESS,
        meta: { limit: 20, next_cursor: 'cursor-page-2' },
      })
      // 2. Page-2 Load More fails
      .mockRejectedValueOnce(new Error('Page 2 timeout'))
      // 3. Switch filter to proficient -> succeeds
      .mockResolvedValueOnce({
        progress: { ...SAMPLE_PROGRESS, skills: [] },
        meta: { limit: 20, next_cursor: null },
      })
      // 4. Restore original filter ('') -> first page succeeds again
      .mockResolvedValueOnce({
        progress: SAMPLE_PROGRESS,
        meta: { limit: 20, next_cursor: 'cursor-page-2' },
      });
    vi.mocked(getProgressHistory).mockResolvedValue({
      items: SAMPLE_HISTORY,
      meta: { limit: 20, next_cursor: null },
    });

    render(<ProgressView accessToken="tok-1" />);

    expect(await screen.findByText('PostgreSQL Indexing')).toBeInTheDocument();

    // Fail page 2 -> inline pagination alert appears while page-1 cards remain
    fireEvent.click(screen.getByRole('button', { name: /Load More Skills/i }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('PostgreSQL Indexing')).toBeInTheDocument();

    // Switch filter -> restore original filter -> first-page success clears matching pagination error
    const stateFilter = screen.getByLabelText(/Filter by mastery state/i);
    fireEvent.change(stateFilter, { target: { value: 'proficient' } });
    expect(
      await screen.findByRole('heading', {
        name: /No skills match your active filters/i,
      }),
    ).toBeInTheDocument();

    fireEvent.change(stateFilter, { target: { value: '' } });
    expect(await screen.findByText('PostgreSQL Indexing')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /^Load More Skills$/i }),
    ).toBeInTheDocument();
  });
});
