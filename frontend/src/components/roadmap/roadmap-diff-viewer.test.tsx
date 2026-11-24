import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import {
  ApiError,
  acceptRoadmapMerge,
  rejectRoadmapMerge,
  type MergeProposalDTO,
} from '@/lib/api/client';
import { RoadmapDiffViewer } from '@/components/roadmap/roadmap-diff-viewer';

vi.mock('@/lib/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/client')>(
    '@/lib/api/client',
  );
  return {
    ...actual,
    acceptRoadmapMerge: vi.fn(),
    rejectRoadmapMerge: vi.fn(),
  };
});

function makeMerge(
  overrides: Partial<MergeProposalDTO> = {},
): MergeProposalDTO {
  return {
    id: 'merge-1',
    roadmap_id: 'rm-1',
    origin: 'user_request',
    status: 'proposed',
    base_version_id: 'ver-2',
    base_version_no: 2,
    result_version_id: null,
    target_level: null,
    instruction: 'Add observability and clean up legacy topics',
    reason: 'Strengthens production readiness and removes legacy overlap.',
    operations: [
      {
        id: 'op-1',
        sort_order: 1,
        op: 'add_topic',
        item_id: null,
        lineage_id: null,
        topic_id: 'top-new',
        skill_id: 'sk-1',
        title: 'OpenTelemetry Tracing',
        priority: 'supporting',
        reason: 'Adds modern observability coverage',
        payload: { phase_no: 2, estimated_effort_hours: 3 },
      },
      {
        id: 'op-2',
        sort_order: 2,
        op: 'update_topic',
        item_id: 'lin-2',
        lineage_id: 'lin-2',
        topic_id: 'top-2',
        skill_id: 'sk-1',
        title: 'SQL Indexing Deep Dive',
        priority: 'core',
        reason: 'Expands required depth for production queries',
        payload: { required_depth: 'B-Tree & partial index tuning' },
      },
      {
        id: 'op-3',
        sort_order: 3,
        op: 'reprioritize',
        item_id: 'lin-3',
        lineage_id: 'lin-3',
        topic_id: 'top-3',
        skill_id: 'sk-1',
        title: 'Structured Logging',
        priority: 'core',
        reason: 'Promoted to Core priority',
        payload: {},
      },
      {
        id: 'op-4',
        sort_order: 4,
        op: 'reclassify',
        item_id: 'lin-4',
        lineage_id: 'lin-4',
        topic_id: 'top-4',
        skill_id: 'sk-1',
        title: 'HTTP Caching',
        priority: 'supporting',
        reason: 'Reclassified as strengthen',
        payload: { gap_type: 'strengthen' },
      },
      {
        id: 'op-5',
        sort_order: 5,
        op: 'retire_topic',
        item_id: 'lin-5',
        lineage_id: 'lin-5',
        topic_id: 'top-5',
        skill_id: 'sk-1',
        title: 'Legacy XML-RPC',
        priority: null,
        reason: 'No longer recommended for target stack',
        payload: {},
      },
    ],
    size_impact: {
      active_topics_before: 10,
      active_topics_after: 10,
      before: 10,
      after: 10,
      delta: 0,
      soft_limit: 45,
      materially_large: false,
      warning: null,
    },
    daily_plan_impact: {
      has_active_plan: true,
      completed_days_unchanged: 4,
      future_days_affected: 3,
    },
    undo_available: false,
    created_at: '2026-11-23T10:00:00.000Z',
    accepted_at: null,
    rejected_at: null,
    undone_at: null,
    undo_window_closed_at: null,
    ...overrides,
  };
}

describe('RoadmapDiffViewer (Component 17)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders all 5 merge operation types without duplicate prefixes, non-wrapping close button header, size impact, and daily plan impact cleanly', () => {
    const onClose = vi.fn();
    render(
      <RoadmapDiffViewer
        accessToken="tok-1"
        roadmapId="rm-1"
        merge={makeMerge()}
        currentVersionNo={2}
        onClose={onClose}
      />,
    );

    expect(screen.getByText('User Request')).toBeInTheDocument();
    const addedLabel = screen.getByText('Added');
    expect(addedLabel).toHaveClass('leading-none');
    const addedPill = addedLabel.parentElement!;
    expect(addedPill).toHaveClass(
      'inline-flex',
      'items-center',
      'justify-center',
      'gap-1.5',
      'text-xs',
      'font-semibold',
      'leading-none',
    );
    expect(addedPill.querySelector('svg')).toHaveClass(
      'block',
      'h-3.5',
      'w-3.5',
      'shrink-0',
    );
    expect(screen.getByText('Updated')).toBeInTheDocument();
    expect(screen.getByText('Reprioritized')).toBeInTheDocument();
    expect(screen.getByText('Reclassified')).toBeInTheDocument();
    expect(screen.getByText('Retired')).toBeInTheDocument();
    expect(screen.queryByText('+ Added')).not.toBeInTheDocument();
    expect(screen.queryByText('- Retired')).not.toBeInTheDocument();

    const closeBtn = screen.getByRole('button', { name: 'Close diff preview' });
    expect(closeBtn).toHaveClass('h-8', 'w-8', 'shrink-0');
    expect(closeBtn.parentElement).toHaveClass(
      'flex',
      'items-start',
      'justify-between',
      'gap-4',
    );
    expect(closeBtn.parentElement).not.toHaveClass('flex-wrap');
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);

    expect(screen.getByText('OpenTelemetry Tracing')).toBeInTheDocument();
    expect(screen.getByText('Legacy XML-RPC')).toBeInTheDocument();
    expect(screen.getByText(/4 completed days unchanged/i)).toBeInTheDocument();
    expect(
      screen.getByText(
        /3 future incomplete days may be reconciled after acceptance\. This count is an estimate until acceptance\./i,
      ),
    ).toBeInTheDocument();
  });

  it('disables Accept while keeping Reject enabled when merge base_version_no is stale', () => {
    render(
      <RoadmapDiffViewer
        accessToken="tok-1"
        roadmapId="rm-1"
        merge={makeMerge({ base_version_no: 1 })}
        currentVersionNo={2}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Accept Merge' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Reject Proposal' }),
    ).toBeEnabled();
  });

  it('gates Accept behind acknowledge_large_expansion when materially_large and sends EP-R11 with Idempotency-Key', async () => {
    const onAccepted = vi.fn();
    vi.mocked(acceptRoadmapMerge).mockResolvedValueOnce({
      roadmap_id: 'rm-1',
      merge_id: 'merge-1',
      new_version_no: 3,
      undo_available: true,
      daily_plan_reconciled: true,
    });

    const largeMerge = makeMerge({
      size_impact: {
        active_topics_before: 42,
        active_topics_after: 49,
        before: 42,
        after: 49,
        delta: 7,
        soft_limit: 45,
        materially_large: true,
        warning: 'This proposal adds 7 topics (49 active topics), exceeding 45.',
      },
    });

    render(
      <RoadmapDiffViewer
        accessToken="tok-1"
        roadmapId="rm-1"
        merge={largeMerge}
        currentVersionNo={2}
        onAccepted={onAccepted}
      />,
    );

    const acceptBtn = screen.getByRole('button', { name: 'Accept Merge' });
    expect(acceptBtn).toBeDisabled();

    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);
    expect(acceptBtn).toBeEnabled();

    fireEvent.click(acceptBtn);

    await waitFor(() => {
      expect(acceptRoadmapMerge).toHaveBeenCalledWith(
        'tok-1',
        'rm-1',
        'merge-1',
        { base_version_no: 2, acknowledge_large_expansion: true },
        expect.stringMatching(/^[0-9a-f-]{36}$/i),
        2,
      );
      expect(onAccepted).toHaveBeenCalledWith(
        expect.objectContaining({ new_version_no: 3, undo_available: true }),
      );
    });
  });

  it('surfaces inline STALE_VERSION recovery and allows Reject even when roadmapGeneratorEnabled is false', async () => {
    const onReloadRequested = vi.fn();
    const onRejected = vi.fn();
    vi.mocked(acceptRoadmapMerge).mockRejectedValueOnce(
      new ApiError(409, 'Version drifted', 'STALE_VERSION'),
    );
    vi.mocked(rejectRoadmapMerge).mockResolvedValueOnce({
      merge_id: 'merge-1',
      status: 'rejected',
      rejected_at: '2026-11-23T11:00:00.000Z',
    });

    const { rerender } = render(
      <RoadmapDiffViewer
        accessToken="tok-1"
        roadmapId="rm-1"
        merge={makeMerge()}
        currentVersionNo={2}
        onReloadRequested={onReloadRequested}
        onRejected={onRejected}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Accept Merge' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /newer version of this roadmap exists/i,
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Reload latest version' }),
    );
    expect(onReloadRequested).toHaveBeenCalledTimes(1);

    // Generation OFF: Accept disabled, Reject stays enabled
    rerender(
      <RoadmapDiffViewer
        accessToken="tok-1"
        roadmapId="rm-1"
        merge={makeMerge()}
        currentVersionNo={2}
        roadmapGeneratorEnabled={false}
        onRejected={onRejected}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Accept Merge' }),
    ).toBeDisabled();
    const rejectBtn = screen.getByRole('button', { name: 'Reject Proposal' });
    expect(rejectBtn).toBeEnabled();

    fireEvent.click(rejectBtn);
    await waitFor(() => {
      expect(rejectRoadmapMerge).toHaveBeenCalledWith(
        'tok-1',
        'rm-1',
        'merge-1',
      );
      expect(onRejected).toHaveBeenCalledTimes(1);
    });

    // canMutate=false (archived roadmap) hides Accept/Reject while keeping diff inspectable
    rerender(
      <RoadmapDiffViewer
        accessToken="tok-1"
        roadmapId="rm-1"
        merge={makeMerge()}
        currentVersionNo={2}
        canMutate={false}
      />,
    );
    expect(screen.getByText('OpenTelemetry Tracing')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Accept Merge' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Reject Proposal' }),
    ).not.toBeInTheDocument();
  });
});
