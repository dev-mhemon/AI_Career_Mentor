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
  type AdminUserDetailDTO,
  type FeatureControlDTO,
  type PaginatedAdminUsersDTO,
} from '@/lib/api/client';

const {
  mockListAdminFeatures,
  mockUpdateGlobalFeature,
  mockListAdminUsers,
  mockGetAdminUser,
  mockUpdateUserFeatureOverride,
} = vi.hoisted(() => ({
  mockListAdminFeatures: vi.fn(),
  mockUpdateGlobalFeature: vi.fn(),
  mockListAdminUsers: vi.fn(),
  mockGetAdminUser: vi.fn(),
  mockUpdateUserFeatureOverride: vi.fn(),
}));

vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/client')>();
  return {
    ...actual,
    listAdminFeatures: mockListAdminFeatures,
    updateGlobalFeature: mockUpdateGlobalFeature,
    listAdminUsers: mockListAdminUsers,
    getAdminUser: mockGetAdminUser,
    updateUserFeatureOverride: mockUpdateUserFeatureOverride,
  };
});

import { AdminFeaturesView } from './admin-features-view';

const USER_ID = '22222222-2222-4222-8222-222222222222';
const USER_B_ID = '33333333-3333-4333-8333-333333333333';
const ADMIN_ID = '11111111-1111-4111-8111-111111111111';

const GLOBAL_FEATURES: FeatureControlDTO[] = [
  {
    feature_key: 'roadmap_generator',
    enabled: true,
    updated_at: '2026-11-24T10:00:00.000Z',
    updated_by: ADMIN_ID,
  },
  {
    feature_key: 'daily_plan',
    enabled: true,
    updated_at: '2026-11-24T10:00:00.000Z',
    updated_by: ADMIN_ID,
  },
  {
    feature_key: 'quiz_practice',
    enabled: true,
    updated_at: '2026-11-24T10:00:00.000Z',
    updated_by: ADMIN_ID,
  },
  {
    feature_key: 'ai_practice_review',
    enabled: true,
    updated_at: '2026-11-24T10:00:00.000Z',
    updated_by: ADMIN_ID,
  },
  {
    feature_key: 'progress_tracking',
    enabled: true,
    updated_at: '2026-11-24T10:00:00.000Z',
    updated_by: ADMIN_ID,
  },
  {
    feature_key: 'ai_mentor',
    enabled: true,
    updated_at: '2026-11-24T10:00:00.000Z',
    updated_by: ADMIN_ID,
  },
  {
    feature_key: 'technology_update',
    enabled: true,
    updated_at: '2026-11-24T10:00:00.000Z',
    updated_by: ADMIN_ID,
  },
];

const SEARCH_USERS: PaginatedAdminUsersDTO = {
  items: [
    {
      id: USER_ID,
      email: 'learner@example.com',
      phone: null,
      contact_masked: 'l***@example.com',
      status: 'active',
      created_at: '2026-11-01T10:00:00.000Z',
      last_active_at: '2026-11-24T12:00:00.000Z',
      roadmap_count: 1,
      technology_update_enabled: false,
    },
  ],
  meta: { limit: 10, next_cursor: null },
};

function makeUserDetail(
  overrides?: Partial<AdminUserDetailDTO>,
): AdminUserDetailDTO {
  return {
    id: USER_ID,
    email: 'learner@example.com',
    phone: null,
    contact_masked: 'l***@example.com',
    status: 'active',
    created_at: '2026-11-01T10:00:00.000Z',
    last_active_at: '2026-11-24T12:00:00.000Z',
    roadmap_count: 1,
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
        global_enabled: false,
        user_override: true,
        effective: false,
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
      roadmaps: 1,
      quizzes_submitted: 3,
      mentor_messages: 5,
      ai_requests: 12,
    },
    ...overrides,
  };
}

describe('AdminFeaturesView (Screen 25 /admin/features — EP-AD04..EP-AD06)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListAdminFeatures.mockResolvedValue(GLOBAL_FEATURES);
    mockListAdminUsers.mockResolvedValue(SEARCH_USERS);
    mockGetAdminUser.mockResolvedValue(makeUserDetail());
  });

  it('renders Effective Access formula visualizer and performs pessimistic global toggles (reverting on error, updating + Toast on success)', async () => {
    render(
      <AdminFeaturesView accessToken="admin-token" initialUserId={USER_ID} />,
    );

    expect(
      screen.getByRole('heading', { level: 1, name: 'Feature Access Controls' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Feature Governance')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Dashboard' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Users' })).not.toBeInTheDocument();

    expect(screen.getByRole('note')).toHaveTextContent(
      /Account Active.*Global Enabled.*User Override \?\? Default.*Effective Access/i,
    );
    expect(screen.getByRole('note')).toHaveTextContent(/technology_update/i);

    const roadmapSwitch = await screen.findByRole('switch', {
      name: 'Roadmap Generator',
    });
    expect(roadmapSwitch).toHaveAttribute('aria-checked', 'true');

    // Failed EP-AD05 keeps exact server state (pessimistic) and shows inline alert
    mockUpdateGlobalFeature.mockRejectedValueOnce(
      new ApiError(422, 'bad key', 'UNKNOWN_FEATURE'),
    );
    fireEvent.click(roadmapSwitch);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        /feature key is not recognized/i,
      );
    });
    expect(roadmapSwitch).toHaveAttribute('aria-checked', 'true');

    // Successful EP-AD05 stays at old value while in flight, updates strictly on 200,
    // shows Toast, and reloads selected user EP-AD02 matrix.
    let resolveGlobal!: (val: FeatureControlDTO) => void;
    mockUpdateGlobalFeature.mockImplementationOnce(
      () =>
        new Promise<FeatureControlDTO>((resolve) => {
          resolveGlobal = resolve;
        }),
    );

    const userFetchCountBefore = mockGetAdminUser.mock.calls.length;
    fireEvent.click(roadmapSwitch);

    // Pessimistic: while pending, switch still reflects old server value and marks aria-busy
    expect(roadmapSwitch).toHaveAttribute('aria-checked', 'true');
    expect(roadmapSwitch).toHaveAttribute('aria-busy', 'true');

    resolveGlobal({
      ...GLOBAL_FEATURES[0],
      enabled: false,
      updated_at: '2026-11-25T05:00:00.000Z',
    });

    await waitFor(() => {
      expect(roadmapSwitch).toHaveAttribute('aria-checked', 'false');
    });
    // Green ON / Amber OFF global status badge styling
    const globalOffBadges = screen.getAllByText('Global OFF');
    expect(
      globalOffBadges.some(
        (badge) =>
          badge.className.includes('text-amber-800') &&
          badge.className.includes('bg-amber-50'),
      ),
    ).toBe(true);
    const globalOnBadges = screen.getAllByText('Global ON');
    expect(
      globalOnBadges.some((badge) =>
        badge.className.includes('text-emerald-700'),
      ),
    ).toBe(true);
    expect(screen.getByTestId('toast-container')).toHaveTextContent(
      /Roadmap Generator is now globally disabled/i,
    );
    await waitFor(() => {
      expect(mockGetAdminUser.mock.calls.length).toBeGreaterThan(
        userFetchCountBefore,
      );
    });
  });

  it('debounces rapid live user search into one EP-AD01 call and performs zero-shake pessimistic 3-state EP-AD06 overrides with green/red badges', async () => {
    render(<AdminFeaturesView accessToken="admin-token" />);

    await screen.findByRole('switch', { name: 'Daily Technology Updates' });

    // Rapid typing fires ONLY ONE listAdminUsers request after the 350ms debounce
    const searchInput = screen.getByLabelText(
      'Find user (email, phone fragment, or UUID)',
    );
    fireEvent.change(searchInput, { target: { value: 'l' } });
    fireEvent.change(searchInput, { target: { value: 'lea' } });
    fireEvent.change(searchInput, { target: { value: 'learner' } });

    expect(mockListAdminUsers).not.toHaveBeenCalled();

    const userList = await screen.findByRole(
      'list',
      { name: 'Matching users' },
      { timeout: 1500 },
    );
    expect(mockListAdminUsers).toHaveBeenCalledTimes(1);
    expect(mockListAdminUsers).toHaveBeenCalledWith(
      'admin-token',
      { q: 'learner', limit: 10 },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    fireEvent.click(
      within(userList).getByRole('button', { name: /learner@example\.com/i }),
    );

    const overrideRegion = await screen.findByRole('region', {
      name: 'Per-user feature overrides table',
    });
    const overrideHeaders = within(overrideRegion).getAllByRole('columnheader');
    expect(overrideHeaders[0].className).toContain('text-left');
    expect(overrideHeaders[1].className).toContain('text-center');
    expect(overrideHeaders[2].className).toContain('text-center');
    expect(overrideHeaders[3].className).toContain('text-right');
    const techGroup = within(overrideRegion).getByRole('group', {
      name: 'Daily Technology Updates override',
    });
    // Fixed-width 3-column zero-shake segmented control
    expect(techGroup.className).toContain('grid-cols-3');
    expect(techGroup.className).toContain('w-[252px]');

    // Initially Inherit (null) -> neutral slate button & Effective OFF (red badge)
    const inheritBtn = within(techGroup).getByRole('button', {
      name: 'Inherit',
    });
    expect(inheritBtn).toHaveAttribute('aria-pressed', 'true');
    expect(inheritBtn.className).toContain('bg-slate-700');
    const effectiveOffBadges = within(overrideRegion).getAllByText('Effective OFF');
    expect(effectiveOffBadges[0].parentElement?.className).toContain(
      'text-red-700',
    );
    const effectiveOnBadges = within(overrideRegion).getAllByText('Effective ON');
    expect(effectiveOnBadges[0].parentElement?.className).toContain(
      'text-emerald-700',
    );

    // Global OFF precedence row (daily_plan has global_enabled=false, user_override=true -> amber Global OFF)
    const tableGlobalOff = within(overrideRegion).getByText('Global OFF');
    expect(tableGlobalOff.className).toContain('text-amber-800');
    expect(tableGlobalOff.className).toContain('bg-amber-50');

    // Selecting a user collapses the search results dropdown
    expect(
      screen.queryByRole('list', { name: 'Matching users' }),
    ).not.toBeInTheDocument();

    // 1. Enable technology_update -> EP-AD06 enabled: true (green active button)
    mockUpdateUserFeatureOverride.mockResolvedValueOnce(
      makeUserDetail({
        technology_update_enabled: true,
        feature_access: makeUserDetail().feature_access.map((f) =>
          f.feature_key === 'technology_update'
            ? { ...f, user_override: true, effective: true }
            : f,
        ),
      }),
    );
    fireEvent.click(within(techGroup).getByRole('button', { name: 'Enabled' }));

    await waitFor(() => {
      expect(mockUpdateUserFeatureOverride).toHaveBeenLastCalledWith(
        'admin-token',
        USER_ID,
        { feature_key: 'technology_update', enabled: true },
      );
    });
    const enabledBtn = within(techGroup).getByRole('button', { name: 'Enabled' });
    expect(enabledBtn).toHaveAttribute('aria-pressed', 'true');
    expect(enabledBtn.className).toContain('bg-emerald-600');

    // 2. Disable technology_update -> EP-AD06 enabled: false (red active button)
    mockUpdateUserFeatureOverride.mockResolvedValueOnce(
      makeUserDetail({
        technology_update_enabled: false,
        feature_access: makeUserDetail().feature_access.map((f) =>
          f.feature_key === 'technology_update'
            ? { ...f, user_override: false, effective: false }
            : f,
        ),
      }),
    );
    fireEvent.click(
      within(techGroup).getByRole('button', { name: 'Disabled' }),
    );
    await waitFor(() => {
      expect(mockUpdateUserFeatureOverride).toHaveBeenLastCalledWith(
        'admin-token',
        USER_ID,
        { feature_key: 'technology_update', enabled: false },
      );
    });
    const disabledBtn = within(techGroup).getByRole('button', {
      name: 'Disabled',
    });
    expect(disabledBtn).toHaveAttribute('aria-pressed', 'true');
    expect(disabledBtn.className).toContain('bg-red-600');

    // 3. Failure when trying Inherit (null) preserves Disabled server state
    mockUpdateUserFeatureOverride.mockRejectedValueOnce(
      new ApiError(403, 'forbidden', 'ADMIN_REQUIRED'),
    );
    fireEvent.click(within(techGroup).getByRole('button', { name: 'Inherit' }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        /administrator access is required/i,
      );
    });
    expect(
      within(techGroup).getByRole('button', { name: 'Disabled' }),
    ).toHaveAttribute('aria-pressed', 'true');

    // 4. Succeeding Inherit (null) reverts override to null
    mockUpdateUserFeatureOverride.mockResolvedValueOnce(makeUserDetail());
    fireEvent.click(within(techGroup).getByRole('button', { name: 'Inherit' }));
    await waitFor(() => {
      expect(mockUpdateUserFeatureOverride).toHaveBeenLastCalledWith(
        'admin-token',
        USER_ID,
        { feature_key: 'technology_update', enabled: null },
      );
    });
    expect(
      within(techGroup).getByRole('button', { name: 'Inherit' }),
    ).toHaveAttribute('aria-pressed', 'true');

    // Inline clear button clears input & active user override table without extra API calls
    fireEvent.click(screen.getByRole('button', { name: 'Clear user search' }));
    expect(searchInput).toHaveValue('');
    expect(
      screen.queryByRole('region', { name: 'Per-user feature overrides table' }),
    ).not.toBeInTheDocument();
    expect(mockListAdminUsers).toHaveBeenCalledTimes(1);
  });

  it('immediately clears previously selected User A override table when typing a new search query before selecting User B', async () => {
    render(
      <AdminFeaturesView accessToken="admin-token" initialUserId={USER_ID} />,
    );

    // User A override table is loaded and visible
    await screen.findByRole('region', {
      name: 'Per-user feature overrides table',
    });
    expect(screen.getByText('learner@example.com')).toBeInTheDocument();

    // Typing a new query immediately clears User A so accidental edits are impossible
    mockListAdminUsers.mockResolvedValueOnce({
      items: [
        {
          id: USER_B_ID,
          email: 'bob@example.com',
          phone: null,
          contact_masked: 'b***@example.com',
          status: 'active',
          created_at: '2026-11-10T10:00:00.000Z',
          last_active_at: null,
          roadmap_count: 0,
          technology_update_enabled: false,
        },
      ],
      meta: { limit: 10, next_cursor: null },
    });
    mockGetAdminUser.mockResolvedValueOnce(
      makeUserDetail({
        id: USER_B_ID,
        email: 'bob@example.com',
        phone: null,
        contact_masked: 'b***@example.com',
      }),
    );

    const searchInput = screen.getByLabelText(
      'Find user (email, phone fragment, or UUID)',
    );
    fireEvent.change(searchInput, { target: { value: 'bob' } });

    expect(
      screen.queryByRole('region', { name: 'Per-user feature overrides table' }),
    ).not.toBeInTheDocument();

    // After debounce, select User B and confirm User B's override table loads cleanly
    const userList = await screen.findByRole(
      'list',
      { name: 'Matching users' },
      { timeout: 1500 },
    );
    fireEvent.click(
      within(userList).getByRole('button', { name: /bob@example\.com/i }),
    );

    await screen.findByRole('region', {
      name: 'Per-user feature overrides table',
    });
    expect(screen.getByText('bob@example.com')).toBeInTheDocument();
    expect(screen.queryByText('learner@example.com')).not.toBeInTheDocument();
  });

  it('displays suspended account override precedence warning when inspected user is suspended', async () => {
    mockGetAdminUser.mockResolvedValueOnce(
      makeUserDetail({
        status: 'suspended',
        feature_access: makeUserDetail().feature_access.map((f) => ({
          ...f,
          effective: false,
        })),
      }),
    );

    render(
      <AdminFeaturesView accessToken="admin-token" initialUserId={USER_ID} />,
    );

    await waitFor(() => {
      expect(
        screen.getByText(/System suspension overrides all feature permissions/i),
      ).toBeInTheDocument();
    });
  });

  it('prevents an older in-flight EP-AD02 reload from overwriting a newer saved EP-AD06 override', async () => {
    render(
      <AdminFeaturesView accessToken="admin-token" initialUserId={USER_ID} />,
    );
    const overrideRegion = await screen.findByRole('region', {
      name: 'Per-user feature overrides table',
    });

    // Global toggle triggers an EP-AD02 reload that resolves later with stale Inherit
    let resolveStaleReload!: (val: AdminUserDetailDTO) => void;
    mockGetAdminUser.mockImplementationOnce(
      () =>
        new Promise<AdminUserDetailDTO>((resolve) => {
          resolveStaleReload = resolve;
        }),
    );
    mockUpdateGlobalFeature.mockResolvedValueOnce({
      ...GLOBAL_FEATURES[0],
      enabled: false,
    });
    fireEvent.click(screen.getByRole('switch', { name: 'Roadmap Generator' }));
    await waitFor(() => expect(mockGetAdminUser).toHaveBeenCalledTimes(2));

    // While reload is still in flight, admin saves technology_update -> Enabled
    mockUpdateUserFeatureOverride.mockResolvedValueOnce(
      makeUserDetail({
        technology_update_enabled: true,
        feature_access: makeUserDetail().feature_access.map((f) =>
          f.feature_key === 'technology_update'
            ? { ...f, user_override: true, effective: true }
            : f,
        ),
      }),
    );
    const techGroup = within(overrideRegion).getByRole('group', {
      name: 'Daily Technology Updates override',
    });
    fireEvent.click(within(techGroup).getByRole('button', { name: 'Enabled' }));

    await waitFor(() => {
      expect(
        within(techGroup).getByRole('button', { name: 'Enabled' }),
      ).toHaveAttribute('aria-pressed', 'true');
    });

    // Stale reload finally resolves with old Inherit state -> MUST NOT overwrite Enabled
    resolveStaleReload(makeUserDetail());
    await new Promise((r) => setTimeout(r, 20));
    expect(
      within(techGroup).getByRole('button', { name: 'Enabled' }),
    ).toHaveAttribute('aria-pressed', 'true');
  });
});
