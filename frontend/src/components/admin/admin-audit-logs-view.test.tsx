import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type { PaginatedAdminAuditLogsDTO } from '@/lib/api/client';

const { mockListAdminAuditLogs } = vi.hoisted(() => ({
  mockListAdminAuditLogs: vi.fn(),
}));

vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/client')>();
  return {
    ...actual,
    listAdminAuditLogs: mockListAdminAuditLogs,
  };
});

import { AdminAuditLogsView } from './admin-audit-logs-view';

const AUDIT_PAGE_1: PaginatedAdminAuditLogsDTO = {
  items: [
    {
      id: '33333333-3333-4333-8333-333333333333',
      actor_id: '11111111-1111-4111-8111-111111111111',
      action: 'user.suspend',
      target_type: 'user',
      target_id: '22222222-2222-4222-8222-222222222222',
      before: { status: 'active' },
      after: { status: 'suspended', reason: 'Internal reason' },
      request_id: '44444444-4444-4444-8444-444444444444',
      created_at: '2026-11-25T10:00:00.000Z',
    },
  ],
  meta: { limit: 20, next_cursor: 'cursor-page-2' },
};

const AUDIT_PAGE_2: PaginatedAdminAuditLogsDTO = {
  items: [
    {
      id: '55555555-5555-4555-8555-555555555555',
      actor_id: '11111111-1111-4111-8111-111111111111',
      action: 'feature.global_update',
      target_type: 'feature_control',
      target_id: null,
      before: { feature_key: 'technology_update', enabled: false },
      after: { feature_key: 'technology_update', enabled: true },
      request_id: null,
      created_at: '2026-11-24T09:00:00.000Z',
    },
  ],
  meta: { limit: 20, next_cursor: null },
};

describe('AdminAuditLogsView (/admin/audit-logs — EP-AD07)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListAdminAuditLogs.mockResolvedValue(AUDIT_PAGE_1);
  });

  it('loads EP-AD07 audit logs, renders clean header, paginates Next/Previous, and resets cursor on filter change', async () => {
    render(<AdminAuditLogsView accessToken="admin-token" />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Admin Audit Logs' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Audit Trail')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Dashboard' }),
    ).not.toBeInTheDocument();

    const auditRegion = await screen.findByRole('region', {
      name: 'Admin audit logs table',
    });
    await waitFor(() => {
      expect(within(auditRegion).getByText('user.suspend')).toBeInTheDocument();
    });
    const auditHeaders = within(auditRegion).getAllByRole('columnheader');
    expect(auditHeaders[0].className).toContain('text-left');
    for (const mid of auditHeaders.slice(1, -1)) {
      expect(mid.className).toContain('text-center');
    }
    expect(auditHeaders[auditHeaders.length - 1].className).toContain(
      'text-right',
    );
    expect(mockListAdminAuditLogs).toHaveBeenCalledWith(
      'admin-token',
      { limit: 20 },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    // Clear filters starts disabled when at defaults
    expect(
      screen.getByRole('button', { name: 'Clear filters' }),
    ).toBeDisabled();

    // Next page uses cursor-page-2
    mockListAdminAuditLogs.mockResolvedValueOnce(AUDIT_PAGE_2);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => {
      expect(mockListAdminAuditLogs).toHaveBeenLastCalledWith(
        'admin-token',
        { limit: 20, cursor: 'cursor-page-2' },
        expect.any(Object),
      );
    });
    expect(
      within(auditRegion).getByText('feature.global_update'),
    ).toBeInTheDocument();

    // Previous page returns to first page
    mockListAdminAuditLogs.mockResolvedValueOnce(AUDIT_PAGE_1);
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    await waitFor(() => {
      expect(mockListAdminAuditLogs).toHaveBeenLastCalledWith(
        'admin-token',
        { limit: 20 },
        expect.any(Object),
      );
    });

    // Applying filter resets cursor to undefined
    mockListAdminAuditLogs.mockResolvedValueOnce({
      items: [],
      meta: { limit: 20, next_cursor: null },
    });
    fireEvent.change(screen.getByLabelText('Action'), {
      target: { value: 'user.reactivate' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }));

    await waitFor(() => {
      expect(mockListAdminAuditLogs).toHaveBeenLastCalledWith(
        'admin-token',
        { action: 'user.reactivate', limit: 20 },
        expect.any(Object),
      );
    });
    expect(
      within(auditRegion).getByText('No matching audit activity'),
    ).toBeInTheDocument();

    // Clear filters resets back to default query
    mockListAdminAuditLogs.mockResolvedValueOnce(AUDIT_PAGE_1);
    fireEvent.click(
      within(auditRegion).getByRole('button', { name: 'Clear filters' }),
    );
    await waitFor(() => {
      expect(mockListAdminAuditLogs).toHaveBeenLastCalledWith(
        'admin-token',
        { limit: 20 },
        expect.any(Object),
      );
    });
  });

  it('validates invalid Actor UUID inline without firing EP-AD07', async () => {
    render(<AdminAuditLogsView accessToken="admin-token" />);

    await waitFor(() =>
      expect(mockListAdminAuditLogs).toHaveBeenCalledTimes(1),
    );

    fireEvent.change(screen.getByLabelText('Actor UUID'), {
      target: { value: 'not-a-uuid' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      /Actor ID must be a valid UUID/i,
    );
    expect(mockListAdminAuditLogs).toHaveBeenCalledTimes(1);
  });
});
