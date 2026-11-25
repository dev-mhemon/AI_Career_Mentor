import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type { UsageSummaryDTO } from '@/lib/api/client';

const { mockGetAdminUsage } = vi.hoisted(() => ({
  mockGetAdminUsage: vi.fn(),
}));

vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/client')>();
  return {
    ...actual,
    getAdminUsage: mockGetAdminUsage,
  };
});

import {
  AdminUsageView,
  getPresetUtcDateRange,
  validateUtcDateRange,
} from './admin-usage-view';

const DAY_USAGE: UsageSummaryDTO = {
  range: { from: '2026-11-19', to: '2026-11-25' },
  series: {
    group_by: 'day',
    buckets: [
      {
        key: '2026-11-24',
        requests: 0,
        estimated_cost_usd: 0,
        failures: 0,
        fallbacks_used: 0,
        input_units: 0,
        output_units: 0,
      },
      {
        key: '2026-11-25',
        requests: 15,
        estimated_cost_usd: 0.125,
        failures: 2,
        fallbacks_used: 1,
        input_units: 10000,
        output_units: 4000,
      },
    ],
  },
  users: { total: 100, active_last_7_days: 55 },
  counts: {
    roadmaps_locked: 42,
    quizzes_submitted: 210,
    mentor_messages: 650,
    technology_updates_generated: 30,
  },
  ai: {
    requests: 15,
    failures: 2,
    fallbacks_used: 1,
    usage_units: { input: 10000, output: 4000 },
    estimated_cost_usd: 0.125,
    by_day: [],
    by_feature: [],
    by_provider: [],
  },
};

const FEATURE_USAGE: UsageSummaryDTO = {
  ...DAY_USAGE,
  series: {
    group_by: 'feature',
    buckets: [
      {
        key: 'ai_mentor',
        requests: 10,
        estimated_cost_usd: 0.08,
        failures: null,
        fallbacks_used: null,
        input_units: null,
        output_units: null,
      },
    ],
  },
};

const PROVIDER_USAGE: UsageSummaryDTO = {
  ...DAY_USAGE,
  series: {
    group_by: 'provider',
    buckets: [
      {
        key: 'gemini',
        requests: 15,
        estimated_cost_usd: 0.125,
        failures: null,
        fallbacks_used: null,
        input_units: null,
        output_units: null,
      },
    ],
  },
};

describe('AdminUsageView (Screen 23 /admin — EP-AD08 R30)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAdminUsage.mockResolvedValue(DAY_USAGE);
  });

  it('defaults to Last 7 Days inclusive UTC, renders clean Admin Dashboard header, retained-window notice, aggregate cards, and series table', async () => {
    render(
      <AdminUsageView
        accessToken="admin-token"
        initialTodayUtc="2026-11-25"
      />,
    );

    await waitFor(() => {
      expect(mockGetAdminUsage).toHaveBeenCalledWith(
        'admin-token',
        { from: '2026-11-19', to: '2026-11-25', group_by: 'day' },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    // Clean Admin Dashboard header — no pill badge, no duplicate nav buttons, no embedded audit logs
    expect(
      screen.getByRole('heading', { level: 1, name: 'Admin Dashboard' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Platform Administration/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Users' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Feature Controls' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: 'Admin audit logs table' }),
    ).not.toBeInTheDocument();

    // Default Range preset is Last 7 Days
    expect(screen.getByLabelText('Range')).toHaveValue('7d');

    // Retained-window notice (R30)
    expect(screen.getByRole('note')).toHaveTextContent(/30 days/i);

    // Aggregate counts rendered
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('650')).toBeInTheDocument();
    expect(
      screen.getByText(/Aggregate count only — content excluded/i),
    ).toBeInTheDocument();

    // Accessible horizontally scrollable table region + column alignment (left / center / right)
    const seriesRegion = screen.getByRole('region', {
      name: 'AI usage series breakdown table',
    });
    expect(seriesRegion).toHaveAttribute('tabindex', '0');
    const seriesHeaders = within(seriesRegion).getAllByRole('columnheader');
    expect(seriesHeaders[0].className).toContain('text-left');
    for (const mid of seriesHeaders.slice(1, -1)) {
      expect(mid.className).toContain('text-center');
    }
    expect(seriesHeaders[seriesHeaders.length - 1].className).toContain(
      'text-right',
    );
    expect(within(seriesRegion).getByText('2026-11-24')).toBeInTheDocument();
    expect(within(seriesRegion).getByText('2026-11-25')).toBeInTheDocument();
  });

  it('switches quick range presets immediately and transitions to Custom on manual DatePicker change', async () => {
    render(
      <AdminUsageView
        accessToken="admin-token"
        initialTodayUtc="2026-11-25"
      />,
    );

    await waitFor(() => expect(mockGetAdminUsage).toHaveBeenCalledTimes(1));

    const rangeSelect = screen.getByLabelText('Range');
    fireEvent.change(rangeSelect, { target: { value: '30d' } });

    await waitFor(() => {
      expect(mockGetAdminUsage).toHaveBeenLastCalledWith(
        'admin-token',
        { from: '2026-10-27', to: '2026-11-25', group_by: 'day' },
        expect.any(Object),
      );
    });

    fireEvent.change(rangeSelect, { target: { value: 'this_month' } });

    await waitFor(() => {
      expect(mockGetAdminUsage).toHaveBeenLastCalledWith(
        'admin-token',
        { from: '2026-11-01', to: '2026-11-25', group_by: 'day' },
        expect.any(Object),
      );
    });

    expect(getPresetUtcDateRange('14d', '2026-11-25')).toEqual({
      from: '2026-11-12',
      to: '2026-11-25',
    });
    expect(getPresetUtcDateRange('90d', '2026-11-25')).toEqual({
      from: '2026-08-28',
      to: '2026-11-25',
    });

    // Manually changing From (UTC) switches Range preset to Custom without firing a fetch until Apply Range
    const callCountBeforeEdit = mockGetAdminUsage.mock.calls.length;
    fireEvent.click(screen.getByLabelText('From (UTC)'));
    const fromCalendar = screen.getByRole('dialog', {
      name: 'From (UTC) calendar',
    });
    fireEvent.click(
      within(fromCalendar).getByRole('button', { name: '2026-11-10' }),
    );
    expect(rangeSelect).toHaveValue('custom');
    expect(mockGetAdminUsage).toHaveBeenCalledTimes(callCountBeforeEdit);

    fireEvent.click(screen.getByRole('button', { name: 'Apply Range' }));
    await waitFor(() => {
      expect(mockGetAdminUsage).toHaveBeenLastCalledWith(
        'admin-token',
        { from: '2026-11-10', to: '2026-11-25', group_by: 'day' },
        expect.any(Object),
      );
    });
  });

  it('validates from > to via DatePicker and > 366 inclusive UTC days inline without calling EP-AD08', async () => {
    render(
      <AdminUsageView
        accessToken="admin-token"
        initialTodayUtc="2026-11-25"
      />,
    );

    await waitFor(() => expect(mockGetAdminUsage).toHaveBeenCalledTimes(1));

    // Open To (UTC) DatePicker and pick a date earlier than From (2026-11-19) -> 2026-11-10
    const toTrigger = screen.getByLabelText('To (UTC)');
    fireEvent.click(toTrigger);
    const toCalendar = screen.getByRole('dialog', {
      name: 'To (UTC) calendar',
    });
    fireEvent.click(
      within(toCalendar).getByRole('button', { name: '2026-11-10' }),
    );

    const applyBtn = screen.getByRole('button', { name: 'Apply Range' });
    fireEvent.click(applyBtn);

    expect(screen.getByRole('alert')).toHaveTextContent(
      /must be on or before/i,
    );
    expect(mockGetAdminUsage).toHaveBeenCalledTimes(1);

    // > 366 inclusive UTC days validation
    expect(validateUtcDateRange('2025-01-01', '2026-01-02')).toMatch(
      /cannot exceed 366 inclusive UTC days/i,
    );
    expect(validateUtcDateRange('2024-01-01', '2024-12-31')).toBeNull();
  });

  it('switches group_by to feature and provider and renders em-dash for null unavailable dimensions per R30', async () => {
    render(
      <AdminUsageView
        accessToken="admin-token"
        initialTodayUtc="2026-11-25"
      />,
    );

    await waitFor(() => expect(mockGetAdminUsage).toHaveBeenCalledTimes(1));

    mockGetAdminUsage.mockResolvedValueOnce(FEATURE_USAGE);
    fireEvent.change(screen.getByLabelText('Group by'), {
      target: { value: 'feature' },
    });

    await waitFor(() => {
      expect(mockGetAdminUsage).toHaveBeenLastCalledWith(
        'admin-token',
        { from: '2026-11-19', to: '2026-11-25', group_by: 'feature' },
        expect.any(Object),
      );
    });

    const seriesRegion = screen.getByRole('region', {
      name: 'AI usage series breakdown table',
    });
    expect(within(seriesRegion).getByText('ai_mentor')).toBeInTheDocument();
    expect(within(seriesRegion).getAllByText('—').length).toBeGreaterThanOrEqual(
      4,
    );

    mockGetAdminUsage.mockResolvedValueOnce(PROVIDER_USAGE);
    fireEvent.change(screen.getByLabelText('Group by'), {
      target: { value: 'provider' },
    });

    await waitFor(() => {
      expect(within(seriesRegion).getByText('gemini')).toBeInTheDocument();
    });
  });

  it('preserves active custom range and group_by when accessToken refreshes without remount', async () => {
    const { rerender } = render(
      <AdminUsageView
        accessToken="admin-token-1"
        initialTodayUtc="2026-11-25"
      />,
    );

    await waitFor(() => expect(mockGetAdminUsage).toHaveBeenCalledTimes(1));

    mockGetAdminUsage.mockResolvedValueOnce(PROVIDER_USAGE);
    fireEvent.change(screen.getByLabelText('Group by'), {
      target: { value: 'provider' },
    });
    await waitFor(() => {
      expect(mockGetAdminUsage).toHaveBeenLastCalledWith(
        'admin-token-1',
        { from: '2026-11-19', to: '2026-11-25', group_by: 'provider' },
        expect.any(Object),
      );
    });

    mockGetAdminUsage.mockResolvedValueOnce(PROVIDER_USAGE);
    rerender(
      <AdminUsageView
        accessToken="admin-token-2"
        initialTodayUtc="2026-11-25"
      />,
    );

    await waitFor(() => {
      expect(mockGetAdminUsage).toHaveBeenLastCalledWith(
        'admin-token-2',
        { from: '2026-11-19', to: '2026-11-25', group_by: 'provider' },
        expect.any(Object),
      );
    });
  });
});
