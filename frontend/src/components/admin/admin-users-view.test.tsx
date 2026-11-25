import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import {
  ApiError,
  NetworkError,
  type AdminUserDetailDTO,
  type PaginatedAdminUsersDTO,
} from '@/lib/api/client';

const {
  mockListAdminUsers,
  mockGetAdminUser,
  mockUpdateAdminUserStatus,
} = vi.hoisted(() => ({
  mockListAdminUsers: vi.fn(),
  mockGetAdminUser: vi.fn(),
  mockUpdateAdminUserStatus: vi.fn(),
}));

vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/client')>();
  return {
    ...actual,
    listAdminUsers: mockListAdminUsers,
    getAdminUser: mockGetAdminUser,
    updateAdminUserStatus: mockUpdateAdminUserStatus,
  };
});

import { AdminUsersView } from './admin-users-view';

const USER_1_ID = '22222222-2222-4222-8222-222222222222';
const USER_2_ID = '33333333-3333-4333-8333-333333333333';

const USERS_PAGE_1: PaginatedAdminUsersDTO = {
  items: [
    {
      id: USER_1_ID,
      email: 'learner@example.com',
      phone: '+8801712345678',
      contact_masked: 'l***@example.com / +8801****5678',
      status: 'active',
      created_at: '2026-11-01T10:00:00.000Z',
      last_active_at: '2026-11-24T12:00:00.000Z',
      roadmap_count: 2,
      technology_update_enabled: false,
    },
    {
      id: USER_2_ID,
      email: null,
      phone: '+8801799995678',
      contact_masked: '+8801****5678',
      status: 'suspended',
      created_at: '2026-10-15T08:00:00.000Z',
      last_active_at: null,
      roadmap_count: 1,
      technology_update_enabled: false,
    },
  ],
  meta: { limit: 20, next_cursor: 'cursor-users-2' },
};

const USER_1_DETAIL: AdminUserDetailDTO = {
  id: USER_1_ID,
  email: 'learner@example.com',
  phone: '+8801712345678',
  contact_masked: 'l***@example.com / +8801****5678',
  status: 'active',
  created_at: '2026-11-01T10:00:00.000Z',
  last_active_at: '2026-11-24T12:00:00.000Z',
  roadmap_count: 2,
  technology_update_enabled: false,
  feature_access: [
    {
      feature_key: 'roadmap_generator',
      global_enabled: true,
      user_override: null,
      effective: true,
    },
    {
      feature_key: 'daily_plan',
      global_enabled: true,
      user_override: null,
      effective: true,
    },
    {
      feature_key: 'quiz_practice',
      global_enabled: true,
      user_override: null,
      effective: true,
    },
    {
      feature_key: 'ai_practice_review',
      global_enabled: true,
      user_override: null,
      effective: true,
    },
    {
      feature_key: 'progress_tracking',
      global_enabled: true,
      user_override: null,
      effective: true,
    },
    {
      feature_key: 'ai_mentor',
      global_enabled: true,
      user_override: null,
      effective: true,
    },
    {
      feature_key: 'technology_update',
      global_enabled: true,
      user_override: null,
      effective: false,
    },
  ],
  counts: {
    roadmaps: 2,
    quizzes_submitted: 7,
    mentor_messages: 19,
    ai_requests: 44,
  },
};

describe('AdminUsersView (Screen 24 /admin/users — EP-AD01..EP-AD03)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListAdminUsers.mockResolvedValue(USERS_PAGE_1);
    mockGetAdminUser.mockResolvedValue(USER_1_DETAIL);
  });

  it('loads users, manages Clear filters enabled/disabled state, and resets cursor on search/status filter changes', async () => {
    render(<AdminUsersView accessToken="admin-token" />);

    const tableRegion = await screen.findByRole('region', {
      name: 'Admin users table',
    });
    await waitFor(() => {
      expect(
        within(tableRegion).getByText('learner@example.com'),
      ).toBeInTheDocument();
    });
    expect(
      within(tableRegion).getByText('+8801712345678'),
    ).toBeInTheDocument();
    expect(
      within(tableRegion).getByRole('columnheader', { name: 'Contact' }),
    ).toBeInTheDocument();

    // Clean header: no pill tag or duplicate nav shortcut links
    expect(
      screen.getByRole('heading', { level: 1, name: 'Platform Users' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('User Management')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Dashboard' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Feature Controls' }),
    ).not.toBeInTheDocument();

    // Table alignment: first left, all middle centered, last right
    const headers = within(tableRegion).getAllByRole('columnheader');
    expect(headers[0].className).toContain('text-left');
    for (const mid of headers.slice(1, -1)) {
      expect(mid.className).toContain('text-center');
    }
    expect(headers[headers.length - 1].className).toContain('text-right');

    const clearBtn = screen.getByRole('button', { name: 'Clear filters' });
    expect(clearBtn).toBeDisabled();
    expect(clearBtn.className).toContain('h-11');
    expect(clearBtn.className).toContain('whitespace-nowrap');

    // Advance to page 2 first
    mockListAdminUsers.mockResolvedValueOnce({
      items: [USERS_PAGE_1.items[1]],
      meta: { limit: 20, next_cursor: null },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => {
      expect(mockListAdminUsers).toHaveBeenLastCalledWith(
        'admin-token',
        { limit: 20, cursor: 'cursor-users-2' },
        expect.any(Object),
      );
    });

    // Changing status filter resets cursor cleanly and enables Clear filters
    mockListAdminUsers.mockResolvedValueOnce({
      items: [USERS_PAGE_1.items[1]],
      meta: { limit: 20, next_cursor: null },
    });
    fireEvent.change(screen.getByLabelText('Account Status'), {
      target: { value: 'suspended' },
    });

    await waitFor(() => {
      expect(mockListAdminUsers).toHaveBeenLastCalledWith(
        'admin-token',
        { status: 'suspended', limit: 20 },
        expect.any(Object),
      );
    });
    expect(clearBtn).toBeEnabled();

    // Search submits q + status with reset cursor
    mockListAdminUsers.mockResolvedValueOnce({
      items: [],
      meta: { limit: 20, next_cursor: null },
    });
    fireEvent.change(
      screen.getByLabelText('Search by email, phone, or User UUID'),
      { target: { value: '8801' } },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => {
      expect(mockListAdminUsers).toHaveBeenLastCalledWith(
        'admin-token',
        { q: '8801', status: 'suspended', limit: 20 },
        expect.any(Object),
      );
    });

    // Clear filters resets back to default
    mockListAdminUsers.mockResolvedValueOnce(USERS_PAGE_1);
    fireEvent.click(clearBtn);
    await waitFor(() => {
      expect(mockListAdminUsers).toHaveBeenLastCalledWith(
        'admin-token',
        { limit: 20 },
        expect.any(Object),
      );
    });
    expect(clearBtn).toBeDisabled();
  });

  it('opens EP-AD02 detail drawer with aggregate-only counts & 7-row feature matrix, and restores focus on Escape', async () => {
    render(<AdminUsersView accessToken="admin-token" />);

    const tableRegion = await screen.findByRole('region', {
      name: 'Admin users table',
    });
    await waitFor(() => {
      expect(
        within(tableRegion).getByText('learner@example.com'),
      ).toBeInTheDocument();
    });
    expect(
      within(tableRegion).getByText('+8801712345678'),
    ).toBeInTheDocument();
    expect(
      within(tableRegion).getByRole('columnheader', { name: 'Contact' }),
    ).toBeInTheDocument();

    const inspectButtons = within(tableRegion).getAllByRole('button', {
      name: /inspect/i,
    });
    expect(inspectButtons[0]).toHaveAttribute(
      'aria-label',
      'Inspect learner@example.com / +8801712345678',
    );
    expect(inspectButtons[0]).toHaveAttribute('title', 'Inspect user');
    expect(inspectButtons[0].querySelector('svg')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    inspectButtons[0].focus();
    fireEvent.click(inspectButtons[0]);

    const drawer = await screen.findByRole('dialog', {
      name: 'User Account Detail',
    });
    await waitFor(() => {
      expect(within(drawer).getByText('19')).toBeInTheDocument();
    });
    expect(within(drawer).getByText('learner@example.com')).toBeInTheDocument();
    expect(within(drawer).getByText('+8801712345678')).toBeInTheDocument();

    expect(
      within(drawer).getByText(/Counts only — private content excluded/i),
    ).toBeInTheDocument();
    const featureRegion = within(drawer).getByRole('region', {
      name: 'User effective feature access table',
    });
    expect(within(featureRegion).getAllByRole('row')).toHaveLength(8); // header + 7 features
    expect(
      within(drawer).getByRole('link', { name: /Manage Feature Overrides/i }),
    ).toHaveAttribute('href', `/admin/features?userId=${USER_1_ID}`);

    // Escape closes drawer and restores opener focus
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(
      screen.queryByRole('dialog', { name: 'User Account Detail' }),
    ).not.toBeInTheDocument();
    expect(document.activeElement).toBe(inspectButtons[0]);
  });

  it('validates EP-AD03 reason (3..300 code points), guards double submit, preserves reason on errors, and refreshes + shows Toast on success', async () => {
    render(<AdminUsersView accessToken="admin-token" />);

    const tableRegion = await screen.findByRole('region', {
      name: 'Admin users table',
    });
    await waitFor(() => {
      expect(
        within(tableRegion).getByText('learner@example.com'),
      ).toBeInTheDocument();
    });
    expect(
      within(tableRegion).getByText('+8801712345678'),
    ).toBeInTheDocument();
    expect(
      within(tableRegion).getByRole('columnheader', { name: 'Contact' }),
    ).toBeInTheDocument();

    fireEvent.click(
      within(tableRegion).getAllByRole('button', { name: /inspect/i })[0],
    );
    const drawer = await screen.findByRole('dialog', {
      name: 'User Account Detail',
    });
    await waitFor(() => {
      expect(
        within(drawer).getByRole('button', { name: 'Suspend User' }),
      ).toBeInTheDocument();
    });

    fireEvent.click(
      within(drawer).getByRole('button', { name: 'Suspend User' }),
    );
    const modal = await screen.findByRole('dialog', {
      name: 'Suspend User Account',
    });

    const reasonBox = within(modal).getByLabelText('Mandatory Audit Reason');
    const confirmBtn = within(modal).getByRole('button', {
      name: 'Confirm Suspend',
    });

    // Too short (< 3 code points)
    fireEvent.change(reasonBox, { target: { value: 'ab' } });
    fireEvent.click(confirmBtn);
    expect(within(modal).getByRole('alert')).toHaveTextContent(
      /between 3 and 300 characters/i,
    );
    expect(mockUpdateAdminUserStatus).not.toHaveBeenCalled();

    // Too long (> 300 code points)
    fireEvent.change(reasonBox, { target: { value: 'a'.repeat(301) } });
    fireEvent.click(confirmBtn);
    expect(within(modal).getByRole('alert')).toHaveTextContent(
      /between 3 and 300 characters/i,
    );
    expect(mockUpdateAdminUserStatus).not.toHaveBeenCalled();

    // 403 CANNOT_MODIFY_ADMIN preserves entered reason
    const validReason = 'Repeated automated abuse of AI endpoints';
    fireEvent.change(reasonBox, { target: { value: validReason } });
    mockUpdateAdminUserStatus.mockRejectedValueOnce(
      new ApiError(403, 'forbidden', 'CANNOT_MODIFY_ADMIN'),
    );
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(within(modal).getByRole('alert')).toHaveTextContent(
        /administrator accounts cannot be suspended or modified/i,
      );
    });
    expect(reasonBox).toHaveValue(validReason);

    // 409 STATUS_UNCHANGED preserves entered reason
    mockUpdateAdminUserStatus.mockRejectedValueOnce(
      new ApiError(409, 'conflict', 'STATUS_UNCHANGED'),
    );
    fireEvent.click(confirmBtn);
    await waitFor(() => {
      expect(within(modal).getByRole('alert')).toHaveTextContent(
        /already in the requested status/i,
      );
    });
    expect(reasonBox).toHaveValue(validReason);

    // NetworkError preserves entered reason
    mockUpdateAdminUserStatus.mockRejectedValueOnce(new NetworkError());
    fireEvent.click(confirmBtn);
    await waitFor(() => {
      expect(within(modal).getByRole('alert')).toHaveTextContent(
        /network problem/i,
      );
    });
    expect(reasonBox).toHaveValue(validReason);

    // Double-submit guard + 200 success closes modal, shows Toast, and refreshes list & detail
    let resolveSubmit!: (val: AdminUserDetailDTO) => void;
    mockUpdateAdminUserStatus.mockImplementationOnce(
      () =>
        new Promise<AdminUserDetailDTO>((resolve) => {
          resolveSubmit = resolve;
        }),
    );

    const callsBefore = mockUpdateAdminUserStatus.mock.calls.length;
    fireEvent.click(confirmBtn);
    fireEvent.click(confirmBtn); // second click while in-flight must be ignored
    expect(mockUpdateAdminUserStatus).toHaveBeenCalledTimes(callsBefore + 1);

    const suspendedDetail: AdminUserDetailDTO = {
      ...USER_1_DETAIL,
      status: 'suspended',
      feature_access: USER_1_DETAIL.feature_access.map((f) => ({
        ...f,
        effective: false,
      })),
    };
    mockListAdminUsers.mockResolvedValueOnce({
      items: [
        { ...USERS_PAGE_1.items[0], status: 'suspended' },
        USERS_PAGE_1.items[1],
      ],
      meta: { limit: 20, next_cursor: null },
    });

    resolveSubmit(suspendedDetail);

    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: 'Suspend User Account' }),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('toast-container')).toHaveTextContent(
      /has been suspended/i,
    );
    expect(
      within(drawer).getByRole('button', { name: 'Reactivate User' }),
    ).toBeInTheDocument();
  });

  it('clears refreshing state when accessToken renews mid-refresh and replacement request settles', async () => {
    const { rerender } = render(<AdminUsersView accessToken="admin-token-1" />);

    const tableRegion = await screen.findByRole('region', {
      name: 'Admin users table',
    });
    await waitFor(() => {
      expect(
        within(tableRegion).getByText('learner@example.com'),
      ).toBeInTheDocument();
    });

    // Trigger a pagination refresh whose request hangs until aborted by token renewal
    mockListAdminUsers.mockImplementationOnce(
      (_token: string, _params: unknown, opts?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          opts?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Refreshing results…')).toBeInTheDocument();

    // Token renews while refresh is in flight -> replacement fetch resolves -> refreshing MUST clear
    mockListAdminUsers.mockResolvedValueOnce({
      items: [USERS_PAGE_1.items[1]],
      meta: { limit: 20, next_cursor: null },
    });
    rerender(<AdminUsersView accessToken="admin-token-2" />);

    await waitFor(() => {
      expect(
        screen.queryByText('Refreshing results…'),
      ).not.toBeInTheDocument();
    });
    expect(mockListAdminUsers).toHaveBeenLastCalledWith(
      'admin-token-2',
      { limit: 20, cursor: 'cursor-users-2' },
      expect.any(Object),
    );
  });
});
