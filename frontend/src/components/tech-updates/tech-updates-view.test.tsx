import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { ApiError, type TechnologyUpdateDTO } from '@/lib/api/client';

const {
  mockListTechnologyUpdates,
  mockGetTechnologyUpdate,
  mockMarkTechnologyUpdateViewed,
} = vi.hoisted(() => ({
  mockListTechnologyUpdates: vi.fn(),
  mockGetTechnologyUpdate: vi.fn(),
  mockMarkTechnologyUpdateViewed: vi.fn(),
}));

vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/client')>();
  return {
    ...actual,
    listTechnologyUpdates: mockListTechnologyUpdates,
    getTechnologyUpdate: mockGetTechnologyUpdate,
    markTechnologyUpdateViewed: mockMarkTechnologyUpdateViewed,
  };
});

import { TechUpdatesView } from './tech-updates-view';

const UPDATE_1: TechnologyUpdateDTO = {
  id: '11111111-1111-4111-8111-111111111111',
  local_date: '2026-11-24',
  title: 'PostgreSQL 17.2 Vacuum Memory Improvements',
  what_changed: 'Added TidStore for vacuum memory efficiency.',
  why_it_matters: 'Reduces index bloat on your Backend Database topics.',
  publisher: 'PostgreSQL Global Development Group',
  source_url: 'https://www.postgresql.org/docs/release/17.2/',
  fetched_at: '2026-11-24T06:15:00.000Z',
  release_status: 'released',
  relevance: 'high',
  action_timing: 'learn_later',
  roadmap_relation: 'Relates to Backend Database Operations topic.',
  viewed: false,
};

const UPDATE_2: TechnologyUpdateDTO = {
  id: '22222222-2222-4222-8222-222222222222',
  local_date: '2026-11-23',
  title: 'Node.js 24 LTS Diagnostics Channel Update',
  what_changed: 'Expanded async context tracing hooks.',
  why_it_matters: 'Helpful for observability in Node.js services.',
  publisher: 'Node.js Foundation',
  source_url: 'https://nodejs.org/en/blog/release/',
  fetched_at: '2026-11-23T06:15:00.000Z',
  release_status: 'announced',
  relevance: 'medium',
  action_timing: 'awareness_only',
  roadmap_relation: null,
  viewed: true,
};

describe('TechUpdatesView (Screen 21 /tech-updates)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('makes ZERO API calls and renders the dedicated default-OFF screen with Subscribe CTA when technologyUpdateEnabled === false (PRD §7, §38)', () => {
    render(
      <TechUpdatesView
        accessToken="tok-off"
        technologyUpdateEnabled={false}
      />,
    );

    expect(mockListTechnologyUpdates).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        'Personalized daily tech updates aligned with your Focus Roadmap.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        name: 'Tech Updates Locked',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Premium feature · Disabled on your plan'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Get one verified, source-grounded technology update each day tailored to your Focus Roadmap, target role, and skills.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /Back to Dashboard/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /View Roadmaps/i }),
    ).not.toBeInTheDocument();

    const subscribeBtn = screen.getByRole('button', { name: 'Subscribe' });
    expect(subscribeBtn).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    fireEvent.click(subscribeBtn);
    expect(subscribeBtn).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('status')).toHaveTextContent(
      'Subscription checkout is coming soon. Contact your administrator to enable early access for your account.',
    );
  });

  it('renders generation_pending === true banner while keeping historical delivered items visible (R25)', async () => {
    mockListTechnologyUpdates.mockResolvedValueOnce({
      data: {
        today_state: null,
        generation_pending: true,
        message: null,
        items: [UPDATE_2],
      },
      meta: { limit: 20, next_cursor: null },
    });

    render(
      <TechUpdatesView accessToken="tok-1" technologyUpdateEnabled={true} />,
    );

    expect(
      await screen.findByRole('heading', {
        name: /Today's technology update is scheduled for background generation/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        name: 'Node.js 24 LTS Diagnostics Channel Update',
      }),
    ).toBeInTheDocument();
  });

  it('renders exact C05 / PRD messages for no_important_changes and temporarily_unavailable today_state values', async () => {
    mockListTechnologyUpdates.mockResolvedValueOnce({
      data: {
        today_state: 'no_important_changes',
        generation_pending: false,
        message: 'No important changes for your current learning path today.',
        items: [],
      },
      meta: { limit: 20, next_cursor: null },
    });

    const { unmount } = render(
      <TechUpdatesView accessToken="tok-1" technologyUpdateEnabled={true} />,
    );

    expect(
      await screen.findByRole('heading', {
        name: 'No important changes for your current learning path today.',
      }),
    ).toBeInTheDocument();
    unmount();

    mockListTechnologyUpdates.mockResolvedValueOnce({
      data: {
        today_state: 'temporarily_unavailable',
        generation_pending: false,
        message: 'Technology updates are temporarily unavailable.',
        items: [],
      },
      meta: { limit: 20, next_cursor: null },
    });

    render(
      <TechUpdatesView accessToken="tok-2" technologyUpdateEnabled={true} />,
    );

    expect(
      await screen.findByRole('heading', {
        name: 'Technology updates are temporarily unavailable.',
      }),
    ).toBeInTheDocument();
  });

  it('supports All / High Relevance / Unread filter pills, Clear filters empty state, EP-T02 detail dialog (Escape closes & restores focus), and EP-T03 Mark as Read', async () => {
    mockListTechnologyUpdates.mockResolvedValueOnce({
      data: {
        today_state: 'available',
        generation_pending: false,
        message: null,
        items: [UPDATE_1, UPDATE_2],
      },
      meta: { limit: 20, next_cursor: null },
    });
    mockGetTechnologyUpdate.mockResolvedValueOnce({
      ...UPDATE_1,
      what_changed: 'Added TidStore for vacuum memory efficiency (detailed view).',
    });
    mockMarkTechnologyUpdateViewed.mockResolvedValueOnce({
      id: UPDATE_1.id,
      viewed: true,
      viewed_at: '2026-11-24T09:00:00.000Z',
    });

    render(
      <TechUpdatesView accessToken="tok-1" technologyUpdateEnabled={true} />,
    );

    expect(
      await screen.findByRole('heading', {
        name: UPDATE_1.title,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        name: UPDATE_2.title,
      }),
    ).toBeInTheDocument();

    // Filter: High Relevance -> shows only UPDATE_1
    const filterGroup = screen.getByRole('group', {
      name: 'Filter technology updates',
    });
    fireEvent.click(
      within(filterGroup).getByRole('button', { name: /High Relevance/i }),
    );
    expect(
      screen.getByRole('heading', { name: UPDATE_1.title }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: UPDATE_2.title }),
    ).not.toBeInTheDocument();

    // Open EP-T02 Detail Dialog
    const card1 = screen.getByRole('article', { name: UPDATE_1.title });
    const viewDetailsBtn = within(card1).getByRole('button', {
      name: /View Details/i,
    });
    fireEvent.click(viewDetailsBtn);

    const dialog = await screen.findByRole('dialog');
    expect(mockGetTechnologyUpdate).toHaveBeenCalledWith(
      'tok-1',
      UPDATE_1.id,
    );
    expect(
      await within(dialog).findByText(
        'Added TidStore for vacuum memory efficiency (detailed view).',
      ),
    ).toBeInTheDocument();

    // Escape closes dialog and restores focus to trigger button
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(document.activeElement).toBe(viewDetailsBtn);

    // Switch to Unread filter -> shows UPDATE_1 (viewed: false)
    fireEvent.click(
      within(filterGroup).getByRole('button', { name: /Unread/i }),
    );
    expect(
      screen.getByRole('heading', { name: UPDATE_1.title }),
    ).toBeInTheDocument();

    // Mark UPDATE_1 as Read (EP-T03)
    const unreadCard = screen.getByRole('article', { name: UPDATE_1.title });
    fireEvent.click(
      within(unreadCard).getByRole('button', { name: /Mark as Read/i }),
    );

    await waitFor(() => {
      expect(mockMarkTechnologyUpdateViewed).toHaveBeenCalledWith(
        'tok-1',
        UPDATE_1.id,
      );
      // Since Unread filter is active and all items are now viewed: true, empty-filter state appears
      expect(
        screen.getByRole('heading', { name: /No updates match this filter/i }),
      ).toBeInTheDocument();
    });

    // Clear filters -> both items visible and UPDATE_1 now shows "Read"
    fireEvent.click(screen.getByRole('button', { name: /Clear filters/i }));
    const updatedCard1 = screen.getByRole('article', { name: UPDATE_1.title });
    expect(within(updatedCard1).getByText('Read')).toBeInTheDocument();
    expect(
      within(updatedCard1).queryByRole('button', { name: /Mark as Read/i }),
    ).not.toBeInTheDocument();
  });

  it('paginates with Load more cursor and preserves loaded items + cursor on pagination error', async () => {
    mockListTechnologyUpdates
      .mockResolvedValueOnce({
        data: {
          today_state: 'available',
          generation_pending: false,
          message: null,
          items: [UPDATE_1],
        },
        meta: { limit: 20, next_cursor: 'cursor-page-2' },
      })
      .mockRejectedValueOnce(
        new ApiError(
          503,
          'Service temporarily unavailable',
          'SERVICE_UNAVAILABLE',
          'req-503',
          [],
          true,
        ),
      )
      .mockResolvedValueOnce({
        data: {
          today_state: 'available',
          generation_pending: false,
          message: null,
          items: [UPDATE_2],
        },
        meta: { limit: 20, next_cursor: null },
      });

    render(
      <TechUpdatesView accessToken="tok-1" technologyUpdateEnabled={true} />,
    );

    expect(
      await screen.findByRole('heading', { name: UPDATE_1.title }),
    ).toBeInTheDocument();

    const loadMoreBtn = screen.getByRole('button', { name: /Load more/i });
    fireEvent.click(loadMoreBtn);

    // First Load more fails -> inline error shown, UPDATE_1 and Load more button preserved
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: UPDATE_1.title }),
    ).toBeInTheDocument();

    // Retry Load more with preserved cursor-page-2
    fireEvent.click(screen.getByRole('button', { name: /Load more/i }));
    expect(
      await screen.findByRole('heading', { name: UPDATE_2.title }),
    ).toBeInTheDocument();
    expect(mockListTechnologyUpdates).toHaveBeenLastCalledWith('tok-1', {
      limit: 20,
      cursor: 'cursor-page-2',
    });
    expect(
      screen.queryByRole('button', { name: /Load more/i }),
    ).not.toBeInTheDocument();
  });

  it('moves focus into the detail dialog, traps Tab focus, preserves completed Mark as Read if an earlier detail GET resolves late, shows Mark as Read errors inside the dialog, and ignores stale pagination from a previous accessToken', async () => {
    let resolveDelayedDetail!: (val: TechnologyUpdateDTO) => void;
    let resolveStaleLoadMore!: (val: {
      data: {
        today_state: 'available';
        generation_pending: false;
        message: null;
        items: TechnologyUpdateDTO[];
      };
      meta: { limit: number; next_cursor: string | null };
    }) => void;

    mockListTechnologyUpdates
      .mockResolvedValueOnce({
        data: {
          today_state: 'available',
          generation_pending: false,
          message: null,
          items: [UPDATE_1],
        },
        meta: { limit: 20, next_cursor: 'cursor-token-a' },
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveStaleLoadMore = resolve;
          }),
      )
      .mockResolvedValueOnce({
        data: {
          today_state: 'available',
          generation_pending: false,
          message: null,
          items: [{ ...UPDATE_2, viewed: false }],
        },
        meta: { limit: 20, next_cursor: null },
      });

    mockGetTechnologyUpdate.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveDelayedDetail = resolve;
        }),
    );

    // First Mark as Read fails inside open dialog -> error appears inside dialog
    // Second Mark as Read succeeds before delayed GET resolves -> viewed: true is preserved
    mockMarkTechnologyUpdateViewed
      .mockRejectedValueOnce(
        new ApiError(
          503,
          'Service unavailable',
          'SERVICE_UNAVAILABLE',
          'req-view-err',
          [],
          true,
        ),
      )
      .mockResolvedValueOnce({
        id: UPDATE_1.id,
        viewed: true,
        viewed_at: '2026-11-24T10:00:00.000Z',
      });

    const { rerender } = render(
      <TechUpdatesView accessToken="token-a" technologyUpdateEnabled={true} />,
    );

    expect(
      await screen.findByRole('heading', { name: UPDATE_1.title }),
    ).toBeInTheDocument();

    const card1 = screen.getByRole('article', { name: UPDATE_1.title });
    fireEvent.click(
      within(card1).getByRole('button', { name: /View Details/i }),
    );

    const dialog = await screen.findByRole('dialog');
    const closeBtn = within(dialog).getByRole('button', {
      name: /Close update details/i,
    });
    const footerCloseBtn = within(dialog).getByRole('button', {
      name: /^Close$/i,
    });
    expect(document.activeElement).toBe(closeBtn);

    // Tab focus trap boundary wrap transitions:
    // 1. Shift+Tab from first focusable control (closeBtn) wraps to last focusable control (footerCloseBtn)
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(footerCloseBtn);

    // 2. Tab from last focusable control (footerCloseBtn) wraps back to first focusable control (closeBtn)
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: false });
    expect(document.activeElement).toBe(closeBtn);

    // Click Mark as Read inside dialog -> first attempt fails and displays alert inside dialog
    fireEvent.click(
      within(dialog).getByRole('button', { name: /Mark as Read/i }),
    );
    expect(await within(dialog).findByRole('alert')).toBeInTheDocument();

    // Retry Mark as Read inside dialog -> succeeds while detail GET is still pending
    fireEvent.click(
      within(dialog).getByRole('button', { name: /Mark as Read/i }),
    );
    await waitFor(() => {
      expect(
        within(dialog).queryByRole('button', { name: /Mark as Read/i }),
      ).not.toBeInTheDocument();
    });

    // Now the earlier detail GET resolves with stale viewed: false -> viewed: true MUST remain preserved
    await act(async () => {
      resolveDelayedDetail({
        ...UPDATE_1,
        what_changed: 'Fresh detail body after read.',
        viewed: false,
      });
    });
    expect(
      await within(dialog).findByText('Fresh detail body after read.'),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByRole('button', { name: /Mark as Read/i }),
    ).not.toBeInTheDocument();

    // Close dialog
    fireEvent.click(closeBtn);

    // Start Load more under token-a, then switch to token-b before token-a pagination finishes
    fireEvent.click(screen.getByRole('button', { name: /Load more/i }));
    rerender(
      <TechUpdatesView accessToken="token-b" technologyUpdateEnabled={true} />,
    );

    expect(
      await screen.findByRole('heading', { name: UPDATE_2.title }),
    ).toBeInTheDocument();

    // Resolve stale token-a pagination -> must NOT append UPDATE_1 into token-b's state
    await act(async () => {
      resolveStaleLoadMore({
        data: {
          today_state: 'available',
          generation_pending: false,
          message: null,
          items: [UPDATE_1],
        },
        meta: { limit: 20, next_cursor: 'stale-cursor' },
      });
    });

    expect(
      screen.queryByRole('heading', { name: UPDATE_1.title }),
    ).not.toBeInTheDocument();
  });

  it('distinguishes 403 ACCOUNT_SUSPENDED from FEATURE_DISABLED, shows Sign In on 401 AUTH_REQUIRED, preserves readActionError when detail GET succeeds, and falls back to Unread filter focus when trigger disconnects', async () => {
    // 1. 403 ACCOUNT_SUSPENDED renders account error alert, NOT Subscribe screen
    mockListTechnologyUpdates.mockRejectedValueOnce(
      new ApiError(
        403,
        'Account suspended',
        'ACCOUNT_SUSPENDED',
        'req-403-susp',
        [],
        false,
      ),
    );

    const { unmount } = render(
      <TechUpdatesView accessToken="tok-susp" technologyUpdateEnabled={true} />,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /You don't have permission to do that\./i,
    );
    expect(
      screen.queryByRole('heading', { name: 'Tech Updates Locked' }),
    ).not.toBeInTheDocument();
    unmount();

    // 2. 401 AUTH_REQUIRED renders Sign In link (/login)
    mockListTechnologyUpdates.mockRejectedValueOnce(
      new ApiError(
        401,
        'Authentication required',
        'AUTH_REQUIRED',
        'req-401',
        [],
        false,
      ),
    );

    const { unmount: unmount401 } = render(
      <TechUpdatesView accessToken="tok-401" technologyUpdateEnabled={true} />,
    );

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign In' })).toHaveAttribute(
      'href',
      '/login',
    );
    unmount401();

    // 3. Separate detailError vs readActionError + focus fallback to Unread filter button when trigger is disconnected
    let resolveDetail!: (val: TechnologyUpdateDTO) => void;
    mockListTechnologyUpdates.mockResolvedValueOnce({
      data: {
        today_state: 'available',
        generation_pending: false,
        message: null,
        items: [UPDATE_1],
      },
      meta: { limit: 20, next_cursor: null },
    });
    mockGetTechnologyUpdate.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveDetail = resolve;
        }),
    );
    mockMarkTechnologyUpdateViewed.mockRejectedValueOnce(
      new ApiError(
        503,
        'View action failed',
        'SERVICE_UNAVAILABLE',
        'req-view-503',
        [],
        true,
      ),
    );

    render(
      <TechUpdatesView accessToken="tok-ok" technologyUpdateEnabled={true} />,
    );

    expect(
      await screen.findByRole('heading', { name: UPDATE_1.title }),
    ).toBeInTheDocument();

    const card = screen.getByRole('article', { name: UPDATE_1.title });
    const viewDetailsBtn = within(card).getByRole('button', {
      name: /View Details/i,
    });
    fireEvent.click(viewDetailsBtn);

    const dialog = await screen.findByRole('dialog');
    // Trigger Mark as Read failure while EP-T02 GET is still in flight
    fireEvent.click(
      within(dialog).getByRole('button', { name: /Mark as Read/i }),
    );
    expect(await within(dialog).findByRole('alert')).toBeInTheDocument();

    // Now EP-T02 GET succeeds -> must NOT erase the readActionError alert inside dialog
    await act(async () => {
      resolveDetail({
        ...UPDATE_1,
        what_changed: 'Fresh detail loaded without erasing readActionError.',
      });
    });
    expect(
      await within(dialog).findByText(
        'Fresh detail loaded without erasing readActionError.',
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('alert')).toBeInTheDocument();

    // Disconnect trigger button from DOM and close dialog -> focus falls back to Unread filter button
    viewDetailsBtn.remove();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    const filterGroup = screen.getByRole('group', {
      name: 'Filter technology updates',
    });
    expect(document.activeElement).toBe(
      within(filterGroup).getByRole('button', { name: /Unread/i }),
    );
  });
});
