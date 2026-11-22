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
  NetworkError,
  createDailyPlan,
  rebuildDailyPlan,
  type DailyPlanResponseDTO,
} from '@/lib/api/client';
import { HoursPromptModal } from './hours-prompt-modal';

vi.mock('@/lib/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/client')>(
    '@/lib/api/client',
  );
  return {
    ...actual,
    createDailyPlan: vi.fn(),
    rebuildDailyPlan: vi.fn(),
  };
});

function makePlan(
  overrides: Partial<DailyPlanResponseDTO> = {},
): DailyPlanResponseDTO {
  return {
    plan_id: 'plan-1',
    roadmap_id: 'rm-1',
    roadmap_version_no: 1,
    is_focus: true,
    hours_per_day: 2,
    total_days: 5,
    completed_days: 0,
    next_incomplete_day_no: 1,
    days: [
      {
        day_no: 1,
        status: 'pending',
        completed_at: null,
        topics: [
          {
            plan_item_id: 'pi-1',
            topic_id: 'top-1',
            title: 'HTTP Fundamentals',
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe('HoursPromptModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createDailyPlan).mockReset();
    vi.mocked(rebuildDailyPlan).mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('validates 0.5..12 half-hour increments, supports quick-select presets and stepper controls, and submits EP-L02 with H-IDEM', async () => {
    const onSuccess = vi.fn();
    const onClose = vi.fn();
    const createdPlan = makePlan({ hours_per_day: 2.5 });
    vi.mocked(createDailyPlan).mockResolvedValueOnce(createdPlan);

    render(
      <HoursPromptModal
        open={true}
        mode="create"
        accessToken="token-1"
        roadmapId="rm-1"
        roadmapTitle="Backend Engineer"
        initialHours={null}
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    );

    const input = screen.getByLabelText(/Hours per day/i) as HTMLInputElement;
    expect(input.value).toBe('');

    // Rejects invalid 0.3 increment without calling API
    fireEvent.change(input, { target: { value: '1.3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Daily Plan' }));
    expect(
      screen.getByText(/between 0.5 and 12 in 0.5-hour increments/i),
    ).toBeInTheDocument();
    expect(createDailyPlan).not.toHaveBeenCalled();

    // Quick-select chip 2h + stepper +0.5 -> 2.5
    fireEvent.click(screen.getByRole('button', { name: '2h' }));
    expect(input.value).toBe('2');
    fireEvent.click(
      screen.getByRole('button', { name: 'Increase daily hours by 0.5' }),
    );
    expect(input.value).toBe('2.5');
    expect(screen.getByText(/17.5 hours \/ week/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Create Daily Plan' }));

    await waitFor(() => {
      expect(createDailyPlan).toHaveBeenCalledWith(
        'token-1',
        { roadmap_id: 'rm-1', hours_per_day: 2.5 },
        expect.stringMatching(/^[0-9a-f-]{36}$/i),
      );
      expect(onSuccess).toHaveBeenCalledWith(createdPlan);
    });
  });

  it('retains H-IDEM key across network failures and rotates H-IDEM key after deterministic 422 errors', async () => {
    const onSuccess = vi.fn();
    const createdPlan = makePlan({ hours_per_day: 2 });

    vi.mocked(createDailyPlan)
      .mockRejectedValueOnce(new NetworkError('offline'))
      .mockRejectedValueOnce(
        new ApiError(422, 'invalid hours', 'LEARNING_HOURS_REQUIRED'),
      )
      .mockResolvedValueOnce(createdPlan);

    render(
      <HoursPromptModal
        open={true}
        mode="create"
        accessToken="token-1"
        roadmapId="rm-1"
        initialHours={2}
        onClose={vi.fn()}
        onSuccess={onSuccess}
      />,
    );

    const submit = screen.getByRole('button', { name: 'Create Daily Plan' });

    // Attempt 1: NetworkError -> retains same key on Attempt 2 and keeps modal viewport-constrained
    fireEvent.click(submit);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveClass('max-h-[90dvh]', 'flex-col', 'overflow-y-auto', 'm-auto');
    expect(dialog.parentElement).toHaveClass('overflow-y-auto');
    expect(dialog.parentElement).not.toHaveClass('items-center');
    expect(dialog.querySelector('form')).toHaveClass('flex', 'min-h-0', 'flex-1', 'flex-col');

    fireEvent.click(submit);
    await waitFor(() => {
      expect(createDailyPlan).toHaveBeenCalledTimes(2);
    });
    const key1 = vi.mocked(createDailyPlan).mock.calls[0][2];
    const key2 = vi.mocked(createDailyPlan).mock.calls[1][2];
    expect(key2).toBe(key1);

    // Attempt 2 returned deterministic 422 -> Attempt 3 must rotate to a fresh key
    fireEvent.click(submit);
    await waitFor(() => {
      expect(createDailyPlan).toHaveBeenCalledTimes(3);
      expect(onSuccess).toHaveBeenCalledWith(createdPlan);
    });
    const key3 = vi.mocked(createDailyPlan).mock.calls[2][2];
    expect(key3).not.toBe(key2);
  });

  it('renders preserved-days disclosure in rebuild mode and calls EP-L03 rebuildDailyPlan', async () => {
    const onSuccess = vi.fn();
    const rebuiltPlan = makePlan({ hours_per_day: 3, total_days: 3 });
    vi.mocked(rebuildDailyPlan).mockResolvedValueOnce(rebuiltPlan);

    render(
      <HoursPromptModal
        open={true}
        mode="rebuild"
        accessToken="token-1"
        roadmapId="rm-1"
        planId="plan-1"
        roadmapTitle="Backend Engineer"
        initialHours={2}
        onClose={vi.fn()}
        onSuccess={onSuccess}
      />,
    );

    expect(
      screen.getByText(/never changes your locked roadmap, completed days/i),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '3h' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Save & Rebuild Plan' }),
    );

    await waitFor(() => {
      expect(rebuildDailyPlan).toHaveBeenCalledWith('token-1', 'plan-1', {
        hours_per_day: 3,
      });
      expect(onSuccess).toHaveBeenCalledWith(rebuiltPlan);
    });
  });

  it('blocks Escape and backdrop dismissal while createDailyPlan is in flight and restores dismissal after settlement', async () => {
    const onClose = vi.fn();
    let rejectCreate!: (err: unknown) => void;
    vi.mocked(createDailyPlan).mockReturnValueOnce(
      new Promise<DailyPlanResponseDTO>((_resolve, reject) => {
        rejectCreate = reject;
      }),
    );

    render(
      <HoursPromptModal
        open={true}
        mode="create"
        accessToken="token-1"
        roadmapId="rm-1"
        initialHours={2}
        onClose={onClose}
        onSuccess={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog');
    const backdrop = dialog.parentElement!;

    fireEvent.click(screen.getByRole('button', { name: 'Create Daily Plan' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Close dialog' })).toBeDisabled();
    });

    // Escape & backdrop clicks MUST NOT close while submitting
    fireEvent.keyDown(dialog, { key: 'Escape' });
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.mouseDown(backdrop);
    fireEvent.mouseUp(backdrop);
    fireEvent.click(backdrop, { detail: 1 });
    expect(onClose).not.toHaveBeenCalled();

    // Settle request -> dismissal works again
    rejectCreate(new NetworkError('offline'));
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
