import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';
import {
  ApiError,
  type ConversationDTO,
  type MessageDTO,
  type MessageResponseDTO,
  type PaginatedConversationsResponseDTO,
  type PaginatedMentorHistoryResponseDTO,
} from '@/lib/api/client';
import { MentorChatView } from './mentor-chat-view';

const mockListMentorConversations = vi.fn();
const mockCreateMentorConversation = vi.fn();
const mockGetMentorHistory = vi.fn();
const mockSendMentorMessage = vi.fn();
const mockGetObservedServerTimeAnchor = vi.fn();

vi.mock('@/lib/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/client')>(
    '@/lib/api/client',
  );
  return {
    ...actual,
    listMentorConversations: (...args: unknown[]) =>
      mockListMentorConversations(...args),
    createMentorConversation: (...args: unknown[]) =>
      mockCreateMentorConversation(...args),
    getMentorHistory: (...args: unknown[]) => mockGetMentorHistory(...args),
    sendMentorMessage: (...args: unknown[]) => mockSendMentorMessage(...args),
    getObservedServerTimeAnchor: () => mockGetObservedServerTimeAnchor(),
  };
});

const TOKEN = 'test-access-token';
const CONV_1: ConversationDTO = {
  id: '11111111-1111-4111-8111-111111111111',
  context_type: 'focus_roadmap',
  roadmap_id: '55555555-5555-4555-8555-555555555555',
  topic_id: null,
  title: 'Backend Focus Plan',
  created_at: '2026-11-24T08:00:00.000Z',
};
const CONV_2: ConversationDTO = {
  id: '22222222-2222-4222-8222-222222222222',
  context_type: 'general',
  roadmap_id: null,
  topic_id: null,
  title: 'Career Switch Q&A',
  created_at: '2026-11-23T08:00:00.000Z',
};
const CONV_3: ConversationDTO = {
  id: '33333333-3333-4333-8333-333333333333',
  context_type: 'topic',
  roadmap_id: '55555555-5555-4555-8555-555555555555',
  topic_id: '44444444-4444-4444-8444-444444444444',
  title: 'PostgreSQL Indexes',
  created_at: '2026-11-22T08:00:00.000Z',
};

const MSG_NEW: MessageDTO = {
  id: 'm-new',
  role: 'assistant',
  content: 'Newest reply in thread',
  language: 'en',
  created_at: '2026-11-24T08:10:00.000Z',
};
const MSG_OLD: MessageDTO = {
  id: 'm-old',
  role: 'user',
  content: 'Older question from yesterday',
  language: 'en',
  created_at: '2026-11-23T08:00:00.000Z',
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-24T12:00:00.000Z'));
  mockListMentorConversations.mockReset();
  mockCreateMentorConversation.mockReset();
  mockGetMentorHistory.mockReset();
  mockSendMentorMessage.mockReset();
  mockGetObservedServerTimeAnchor.mockReset();
  mockGetObservedServerTimeAnchor.mockReturnValue(null);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('MentorChatView (Screen 20 /mentor)', () => {
  it('loads conversations, paginates Load more, handles 409 NO_FOCUS_ROADMAP with /roadmaps + General fallback, and creates topic chat', async () => {
    const page1: PaginatedConversationsResponseDTO = {
      items: [CONV_1],
      meta: { limit: 20, next_cursor: 'cursor-page-2' },
    };
    const page2: PaginatedConversationsResponseDTO = {
      items: [CONV_2],
      meta: { limit: 20, next_cursor: null },
    };
    mockListMentorConversations
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce(page2);
    mockGetMentorHistory.mockResolvedValue({
      items: [MSG_NEW],
      meta: { limit: 20, next_cursor: null },
    } satisfies PaginatedMentorHistoryResponseDTO);

    mockCreateMentorConversation
      .mockRejectedValueOnce(
        new ApiError(
          409,
          'No focus roadmap selected',
          'NO_FOCUS_ROADMAP',
          'req-nf-1',
        ),
      )
      .mockResolvedValueOnce(CONV_3);

    render(
      <MentorChatView
        accessToken={TOKEN}
        aiMentorEnabled={true}
        initialContext="topic"
        initialTopicId={CONV_3.topic_id!}
      />,
    );

    const sidebar = screen.getByRole('complementary', {
      name: /Mentor conversations sidebar/i,
    });
    expect(await within(sidebar).findByText('Backend Focus Plan')).toBeInTheDocument();

    // Requested ?context=topic&topicId=... has no match in first page while nextCursor !== null ->
    // states no match in currently loaded conversations and offers Load more conversations button
    const contextualCard = screen.getByTestId('contextual-start-card');
    expect(contextualCard).toBeInTheDocument();
    expect(
      within(contextualCard).getByRole('heading', {
        name: /Start a Topic Conversation/i,
      }),
    ).toBeInTheDocument();
    expect(
      within(contextualCard).getByText(/currently loaded conversations/i),
    ).toBeInTheDocument();
    expect(
      within(contextualCard).getByRole('button', {
        name: /Load more conversations/i,
      }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('mentor-composer-card')).not.toBeInTheDocument();

    // Load more conversations (EP-M02 cursor pagination) -> once nextCursor === null, shows final no-match copy
    fireEvent.click(within(sidebar).getByRole('button', { name: /Load more/i }));
    expect(await within(sidebar).findByText('Career Switch Q&A')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('contextual-start-card')).getByText(
        /No existing chat was found for this topic yet/i,
      ),
    ).toBeInTheDocument();
    expect(mockListMentorConversations).toHaveBeenLastCalledWith(TOKEN, {
      limit: 20,
      cursor: 'cursor-page-2',
    });

    // Attempt focus_roadmap creation -> 409 NO_FOCUS_ROADMAP shows inline recovery card
    fireEvent.click(
      within(sidebar).getByRole('button', { name: /Focus Roadmap Chat/i }),
    );
    expect(
      await within(sidebar).findByText(/No Focus Roadmap selected/i),
    ).toBeInTheDocument();
    expect(
      within(sidebar).getByRole('link', { name: /Open Roadmaps/i }),
    ).toHaveAttribute('href', '/roadmaps');
    expect(
      within(sidebar).getByRole('button', { name: /Start General Chat/i }),
    ).toBeInTheDocument();

    // Start Current Topic Chat passes initialTopicId
    fireEvent.click(
      within(sidebar).getByRole('button', { name: /Start Current Topic Chat/i }),
    );
    await waitFor(() => {
      expect(mockCreateMentorConversation).toHaveBeenLastCalledWith(TOKEN, {
        context_type: 'topic',
        topic_id: CONV_3.topic_id,
      });
    });
    expect(
      await within(sidebar).findByText('PostgreSQL Indexes'),
    ).toBeInTheDocument();

    // Collapsible context-grouped history sections: Focus Roadmap, Topic Chats, General
    const focusGroupBtn = within(sidebar).getByRole('button', {
      name: /^Focus Roadmap$/i,
    });
    const topicGroupBtn = within(sidebar).getByRole('button', {
      name: /^Topic Chats$/i,
    });
    const generalGroupBtn = within(sidebar).getByRole('button', {
      name: /^General$/i,
    });
    expect(focusGroupBtn).toHaveAttribute('aria-expanded', 'true');
    expect(topicGroupBtn).toHaveAttribute('aria-expanded', 'true');
    expect(generalGroupBtn).toHaveAttribute('aria-expanded', 'true');

    // Collapsing General keeps panel mounted inside CSS Grid accordion with aria-hidden + inert + grid-rows-[0fr]
    const generalPanel = within(sidebar).getByTestId(
      'conversation-group-panel-general',
    );
    expect(generalPanel).toHaveAttribute('aria-hidden', 'false');
    expect(generalPanel.className).toContain('grid-rows-[1fr]');

    fireEvent.click(generalGroupBtn);
    expect(generalGroupBtn).toHaveAttribute('aria-expanded', 'false');
    expect(generalPanel).toHaveAttribute('aria-hidden', 'true');
    expect(generalPanel).toHaveAttribute('inert');
    expect(generalPanel.className).toContain('grid-rows-[0fr]');

    fireEvent.click(generalGroupBtn);
    expect(generalGroupBtn).toHaveAttribute('aria-expanded', 'true');
    expect(generalPanel).toHaveAttribute('aria-hidden', 'false');
    expect(generalPanel).not.toHaveAttribute('inert');
    expect(generalPanel.className).toContain('grid-rows-[1fr]');
    expect(
      within(sidebar).getByText('Career Switch Q&A'),
    ).toBeInTheDocument();

    // Unified composer omits legacy "Enter to send" helper copy while retaining locale-consistent counter & Send button inside card
    const composerCard = screen.getByTestId('mentor-composer-card');
    expect(composerCard).toBeInTheDocument();
    expect(
      screen.queryByText(/Enter to send/i),
    ).not.toBeInTheDocument();
    const expectedCounter = `0 / ${(4_000).toLocaleString('en-US')}`;
    expect(within(composerCard).getByText(expectedCounter)).toBeInTheDocument();
    expect(
      within(composerCard).getByRole('button', { name: /Send message/i }),
    ).toBeInTheDocument();

    // Full-viewport fixed workspace: sr-only heading, no top breadcrumb, independent message scroll pane
    const main = screen.getByRole('main');
    expect(main.className).toContain('h-[calc(100dvh-4rem)]');
    expect(main.className).toContain('overflow-hidden');
    expect(
      screen.getByRole('heading', { level: 1, name: /AI Career Mentor/i }),
    ).toHaveClass('sr-only');
    expect(
      screen.queryByRole('navigation', { name: /Breadcrumb/i }),
    ).not.toBeInTheDocument();
    const scrollLog = screen.getByTestId('mentor-messages-scroll');
    expect(scrollLog).toHaveClass('overflow-y-auto');
    expect(scrollLog).toHaveAttribute('role', 'log');
    expect(scrollLog).toHaveAttribute('aria-label', 'Mentor conversation');
  });

  it('loads paginated history, loads older messages, sends a turn, and reuses exact client_message_id on 504 retry', async () => {
    mockListMentorConversations.mockResolvedValueOnce({
      items: [CONV_1],
      meta: { limit: 20, next_cursor: null },
    } satisfies PaginatedConversationsResponseDTO);

    mockGetMentorHistory
      .mockResolvedValueOnce({
        items: [MSG_NEW],
        meta: { limit: 20, next_cursor: 'older-cur-1' },
      } satisfies PaginatedMentorHistoryResponseDTO)
      .mockResolvedValueOnce({
        items: [MSG_OLD],
        meta: { limit: 20, next_cursor: null },
      } satisfies PaginatedMentorHistoryResponseDTO);

    const successReply: MessageResponseDTO = {
      user_message_id: 'u-msg-committed',
      assistant_message: {
        id: 'a-msg-committed',
        role: 'assistant',
        content: 'B-Tree indexes speed up range queries.',
        language: 'en',
        created_at: '2026-11-24T08:15:00.000Z',
      },
      safety_mode: false,
      learning_claim_recorded: true,
    };

    mockSendMentorMessage
      .mockRejectedValueOnce(
        new ApiError(504, 'Timeout', 'AI_TIMEOUT', 'req-to-1', [], true),
      )
      .mockResolvedValueOnce(successReply);

    render(<MentorChatView accessToken={TOKEN} aiMentorEnabled={true} />);

    // Initial history loaded
    expect(await screen.findByText('Newest reply in thread')).toBeInTheDocument();

    // Load older messages (EP-M04 cursor pagination)
    fireEvent.click(
      screen.getByRole('button', { name: /Load older messages/i }),
    );
    expect(
      await screen.findByText('Older question from yesterday'),
    ).toBeInTheDocument();
    expect(mockGetMentorHistory).toHaveBeenLastCalledWith(
      TOKEN,
      {
        conversation_id: CONV_1.id,
        limit: 20,
        cursor: 'older-cur-1',
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    // Send message -> first attempt fails with 504 AI_TIMEOUT
    const input = screen.getByLabelText(/Message AI Career Mentor/i);
    fireEvent.change(input, {
      target: { value: 'I studied B-Tree indexes today' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Send message/i }));

    expect(
      await screen.findByText(/timed out.*saved/i),
    ).toBeInTheDocument();
    expect(mockSendMentorMessage).toHaveBeenCalledTimes(1);
    const firstPayload = mockSendMentorMessage.mock.calls[0][1] as {
      conversation_id: string;
      content: string;
      client_message_id: string;
    };
    expect(firstPayload.conversation_id).toBe(CONV_1.id);
    expect(firstPayload.content).toBe('I studied B-Tree indexes today');
    expect(firstPayload.client_message_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );

    // Retry reuses the EXACT same client_message_id
    fireEvent.click(screen.getByRole('button', { name: /^Retry$/i }));
    expect(
      await screen.findByText('B-Tree indexes speed up range queries.'),
    ).toBeInTheDocument();

    expect(mockSendMentorMessage).toHaveBeenCalledTimes(2);
    const secondPayload = mockSendMentorMessage.mock.calls[1][1] as {
      conversation_id: string;
      content: string;
      client_message_id: string;
    };
    expect(secondPayload.client_message_id).toBe(firstPayload.client_message_id);
    expect(screen.getByRole('note')).toHaveTextContent(
      /Recorded as conversation context only/i,
    );
  });

  it('preserves 90-day read-only history when aiMentorEnabled is false', async () => {
    mockListMentorConversations.mockResolvedValueOnce({
      items: [CONV_1, CONV_2],
      meta: { limit: 20, next_cursor: null },
    } satisfies PaginatedConversationsResponseDTO);

    mockGetMentorHistory.mockImplementation(
      async (_token: string, params: { conversation_id: string }) => {
        if (params.conversation_id === CONV_1.id) {
          return {
            items: [MSG_NEW],
            meta: { limit: 20, next_cursor: null },
          };
        }
        return {
          items: [MSG_OLD],
          meta: { limit: 20, next_cursor: null },
        };
      },
    );

    render(<MentorChatView accessToken={TOKEN} aiMentorEnabled={false} />);

    expect(
      screen.getByText(/AI Mentor is currently disabled/i),
    ).toBeInTheDocument();
    expect(await screen.findByText('Newest reply in thread')).toBeInTheDocument();

    // Composer and creator buttons disabled
    expect(screen.getByLabelText(/Message AI Career Mentor/i)).toBeDisabled();
    expect(screen.getByRole('button', { name: /Send message/i })).toBeDisabled();
    const sidebar = screen.getByRole('complementary', {
      name: /Mentor conversations sidebar/i,
    });
    expect(
      within(sidebar).getByRole('button', { name: /Focus Roadmap Chat/i }),
    ).toBeDisabled();

    // Switching conversations still loads 90-day history cleanly
    fireEvent.click(
      within(sidebar).getByRole('button', { name: /Career Switch Q&A/i }),
    );
    expect(
      await screen.findByText('Older question from yesterday'),
    ).toBeInTheDocument();
  });

  it('aborts stale history fetch on rapid conversation switch so previous thread never overwrites active thread', async () => {
    mockListMentorConversations.mockResolvedValueOnce({
      items: [CONV_1, CONV_2],
      meta: { limit: 20, next_cursor: null },
    } satisfies PaginatedConversationsResponseDTO);

    let resolveConv1!: (value: PaginatedMentorHistoryResponseDTO) => void;
    let conv1Signal: AbortSignal | undefined;

    mockGetMentorHistory.mockImplementation(
      (
        _token: string,
        params: { conversation_id: string },
        options?: { signal?: AbortSignal },
      ) => {
        if (params.conversation_id === CONV_1.id) {
          conv1Signal = options?.signal;
          return new Promise<PaginatedMentorHistoryResponseDTO>((resolve) => {
            resolveConv1 = resolve;
          });
        }
        return Promise.resolve({
          items: [
            {
              id: 'conv2-msg-1',
              role: 'assistant',
              content: 'Conversation 2 authoritative reply',
              language: 'en',
              created_at: '2026-11-24T09:00:00.000Z',
            },
          ],
          meta: { limit: 20, next_cursor: null },
        } satisfies PaginatedMentorHistoryResponseDTO);
      },
    );

    render(<MentorChatView accessToken={TOKEN} aiMentorEnabled={true} />);

    const sidebar = screen.getByRole('complementary', {
      name: /Mentor conversations sidebar/i,
    });
    await within(sidebar).findByText('Career Switch Q&A');

    // Switch immediately to CONV_2 while CONV_1 history request is still pending
    fireEvent.click(
      within(sidebar).getByRole('button', { name: /Career Switch Q&A/i }),
    );

    expect(
      await screen.findByText('Conversation 2 authoritative reply'),
    ).toBeInTheDocument();
    expect(conv1Signal?.aborted).toBe(true);

    // Late resolution of CONV_1 must NOT overwrite CONV_2's visible messages
    await act(async () => {
      resolveConv1({
        items: [
          {
            id: 'conv1-stale',
            role: 'assistant',
            content: 'Stale conversation 1 leaked message',
            language: 'en',
            created_at: '2026-11-24T08:00:00.000Z',
          },
        ],
        meta: { limit: 20, next_cursor: null },
      });
      await Promise.resolve();
    });

    expect(
      screen.getByText('Conversation 2 authoritative reply'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Stale conversation 1 leaked message'),
    ).not.toBeInTheDocument();
  });

  it('isolates per-conversation drafts, ignores IME composing Enter, restores editable draft on permanent 422 rejection, and orders skewed-clock turns cleanly', async () => {
    // Override browser clock strictly LATER than mocked server reply timestamp (08:11:00Z)
    vi.setSystemTime(new Date('2026-11-24T12:00:00.000Z'));

    mockListMentorConversations.mockResolvedValueOnce({
      items: [CONV_1, CONV_2],
      meta: { limit: 20, next_cursor: null },
    } satisfies PaginatedConversationsResponseDTO);

    mockGetMentorHistory.mockResolvedValue({
      items: [MSG_NEW],
      meta: { limit: 20, next_cursor: null },
    } satisfies PaginatedMentorHistoryResponseDTO);

    // Permanent 422 rejection (retryable=false), then a valid reply with server timestamp BEFORE browser clock
    mockSendMentorMessage
      .mockRejectedValueOnce(
        new ApiError(
          422,
          'Unsupported language',
          'UNSUPPORTED_LANGUAGE',
          'req-perm-1',
          [],
          false,
        ),
      )
      .mockResolvedValueOnce({
        user_message_id: 'u-skew-1',
        assistant_message: {
          id: 'a-skew-1',
          role: 'assistant',
          content: 'Server-timed assistant reply',
          language: 'en',
          // Strictly earlier than the 12:00:00Z browser clock to simulate fast local clock skew
          created_at: '2026-11-24T08:11:00.000Z',
        },
        safety_mode: false,
        learning_claim_recorded: false,
      } satisfies MessageResponseDTO);

    render(<MentorChatView accessToken={TOKEN} aiMentorEnabled={true} />);
    expect(
      await screen.findByText('Newest reply in thread'),
    ).toBeInTheDocument();

    const sidebar = screen.getByRole('complementary', {
      name: /Mentor conversations sidebar/i,
    });
    const input = screen.getByLabelText(
      /Message AI Career Mentor/i,
    ) as HTMLTextAreaElement;

    // Type draft in CONV_1 -> switch to CONV_2 (clean draft) -> return to CONV_1 (restored draft)
    fireEvent.change(input, { target: { value: 'Draft for Backend Focus' } });
    expect(input.value).toBe('Draft for Backend Focus');

    fireEvent.click(
      within(sidebar).getByRole('button', { name: /Career Switch Q&A/i }),
    );
    await waitFor(() => {
      expect(input.value).toBe('');
    });
    fireEvent.change(input, { target: { value: 'Draft for Career Switch' } });
    expect(input.value).toBe('Draft for Career Switch');

    fireEvent.click(
      within(sidebar).getByRole('button', { name: /Backend Focus Plan/i }),
    );
    await waitFor(() => {
      expect(input.value).toBe('Draft for Backend Focus');
    });

    // IME composition Enter must NOT send
    fireEvent.keyDown(input, {
      key: 'Enter',
      isComposing: true,
      keyCode: 229,
    });
    expect(mockSendMentorMessage).not.toHaveBeenCalled();

    // Permanent rejection (422) when composer is empty restores draft & shows inline error without a same-ID Retry bubble
    fireEvent.click(screen.getByRole('button', { name: /Send message/i }));
    expect(
      await screen.findByText(/Bangla.*English.*Mixed/i),
    ).toBeInTheDocument();
    expect(input.value).toBe('Draft for Backend Focus');
    expect(
      screen.queryByRole('button', { name: /^Retry$/i }),
    ).not.toBeInTheDocument();

    const firstClientId = (
      mockSendMentorMessage.mock.calls[0][1] as { client_message_id: string }
    ).client_message_id;

    // Resend edited message -> uses fresh client_message_id and orders user message BEFORE server-timed reply
    fireEvent.change(input, {
      target: { value: 'Corrected question about indexing' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Send message/i }));
    expect(
      await screen.findByText('Server-timed assistant reply'),
    ).toBeInTheDocument();

    const secondClientId = (
      mockSendMentorMessage.mock.calls[1][1] as { client_message_id: string }
    ).client_message_id;
    expect(secondClientId).not.toBe(firstClientId);

    const thread = screen.getByTestId('mentor-messages-scroll');
    const articles = within(thread).getAllByRole('article');
    const userIdx = articles.findIndex((el) =>
      el.textContent?.includes('Corrected question about indexing'),
    );
    const asstIdx = articles.findIndex((el) =>
      el.textContent?.includes('Server-timed assistant reply'),
    );
    expect(userIdx).toBeGreaterThanOrEqual(0);
    expect(asstIdx).toBeGreaterThan(userIdx);
  });

  it('shows thread-scoped inline error on Load older messages failure while preserving cursor, and closes mobile dialog on Escape restoring focus', async () => {
    mockListMentorConversations.mockResolvedValueOnce({
      items: [CONV_1],
      meta: { limit: 20, next_cursor: null },
    } satisfies PaginatedConversationsResponseDTO);

    mockGetMentorHistory
      .mockResolvedValueOnce({
        items: [MSG_NEW],
        meta: { limit: 20, next_cursor: 'older-cur-err' },
      } satisfies PaginatedMentorHistoryResponseDTO)
      .mockRejectedValueOnce(
        new ApiError(503, 'Temporary error', 'SERVICE_UNAVAILABLE', 'req-old-1', [], true),
      )
      .mockResolvedValueOnce({
        items: [MSG_OLD],
        meta: { limit: 20, next_cursor: null },
      } satisfies PaginatedMentorHistoryResponseDTO);

    render(<MentorChatView accessToken={TOKEN} aiMentorEnabled={true} />);
    expect(await screen.findByText('Newest reply in thread')).toBeInTheDocument();

    // Failing older-page load shows inline error and preserves loaded messages + button/cursor
    fireEvent.click(
      screen.getByRole('button', { name: /Load older messages/i }),
    );
    expect(
      await screen.findByTestId('older-history-error'),
    ).toBeInTheDocument();
    expect(screen.getByText('Newest reply in thread')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Load older messages/i }),
    ).toBeInTheDocument();

    // Retrying clears the inline error and prepends older history
    fireEvent.click(
      screen.getByRole('button', { name: /Load older messages/i }),
    );
    expect(
      await screen.findByText('Older question from yesterday'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('older-history-error'),
    ).not.toBeInTheDocument();

    // Mobile Conversations dialog opens with modal ARIA attributes, closes on Escape, and restores focus to trigger
    const triggerBtn = screen.getByRole('button', {
      name: /Open conversations drawer/i,
    });
    triggerBtn.focus();
    fireEvent.click(triggerBtn);

    const dialog = screen.getByRole('dialog', { name: 'Conversations' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(
      screen.queryByRole('dialog', { name: 'Conversations' }),
    ).not.toBeInTheDocument();
    expect(document.activeElement).toBe(triggerBtn);
  });

  it('closes mobile drawer and clears inert when crossing desktop lg breakpoint, and preserves draft B on permanent rejection of retried message A', async () => {
    const mediaListeners = new Set<(event: MediaQueryListEvent) => void>();
    const mqlState = { matches: false };
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      get matches() {
        return mqlState.matches;
      },
      media: query,
      onchange: null,
      addEventListener: (
        event: string,
        cb: (e: MediaQueryListEvent) => void,
      ) => {
        if (event === 'change') {
          mediaListeners.add(cb);
        }
      },
      removeEventListener: (
        event: string,
        cb: (e: MediaQueryListEvent) => void,
      ) => {
        if (event === 'change') {
          mediaListeners.delete(cb);
        }
      },
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    try {
      mockListMentorConversations.mockResolvedValueOnce({
        items: [CONV_1],
        meta: { limit: 20, next_cursor: null },
      } satisfies PaginatedConversationsResponseDTO);
      mockGetMentorHistory.mockResolvedValueOnce({
        items: [MSG_NEW],
        meta: { limit: 20, next_cursor: null },
      } satisfies PaginatedMentorHistoryResponseDTO);
      // Message A first fails retryably (504), then fails permanently (422) on Retry while draft B is typed
      mockSendMentorMessage
        .mockRejectedValueOnce(
          new ApiError(504, 'Timeout', 'AI_TIMEOUT', 'req-a-1', [], true),
        )
        .mockRejectedValueOnce(
          new ApiError(
            422,
            'Unsupported language',
            'UNSUPPORTED_LANGUAGE',
            'req-a-2',
            [],
            false,
          ),
        );

      render(<MentorChatView accessToken={TOKEN} aiMentorEnabled={true} />);
      expect(
        await screen.findByText('Newest reply in thread'),
      ).toBeInTheDocument();

      // 1. Open mobile drawer -> workspace becomes inert -> desktop breakpoint change closes drawer & clears inert
      const triggerBtn = screen.getByRole('button', {
        name: /Open conversations drawer/i,
      });
      fireEvent.click(triggerBtn);
      expect(
        screen.getByRole('dialog', { name: 'Conversations' }),
      ).toBeInTheDocument();
      const workspaceGrid = screen
        .getByRole('main')
        .querySelector('[inert]');
      expect(workspaceGrid).not.toBeNull();

      act(() => {
        mqlState.matches = true;
        for (const listener of mediaListeners) {
          listener({ matches: true, media: '(min-width: 1024px)' } as MediaQueryListEvent);
        }
      });

      expect(
        screen.queryByRole('dialog', { name: 'Conversations' }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole('main').querySelector('[inert]')).toBeNull();

      // 2. Send Message A -> retryable 504 -> learner types Draft B -> retries Message A -> permanent 422
      const input = screen.getByLabelText(
        /Message AI Career Mentor/i,
      ) as HTMLTextAreaElement;
      fireEvent.change(input, {
        target: { value: 'Message A that will fail permanently on retry' },
      });
      fireEvent.click(screen.getByRole('button', { name: /Send message/i }));
      expect(
        await screen.findByRole('button', { name: /^Retry$/i }),
      ).toBeInTheDocument();

      fireEvent.change(input, {
        target: { value: 'Draft B must never be overwritten' },
      });
      expect(input.value).toBe('Draft B must never be overwritten');

      fireEvent.click(screen.getByRole('button', { name: /^Retry$/i }));
      expect(
        await screen.findByTestId('chat-message-permanent-error'),
      ).toBeInTheDocument();

      // Draft B preserved untouched, Message A remains visible as non-retryable permanent-error bubble with NO Retry button
      expect(input.value).toBe('Draft B must never be overwritten');
      expect(
        screen.getByText('Message A that will fail permanently on retry'),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /^Retry$/i }),
      ).not.toBeInTheDocument();
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  it('ignores wall-clock jumps when server time is unknown or anchored, and evicts aged messages only on monotonic elapsed server time', async () => {
    // Browser wall clock is 1 year ahead of retained messages
    vi.setSystemTime(new Date('2027-11-24T12:00:00.000Z'));

    let monotonicClock = 1_000;
    const perfSpy = vi
      .spyOn(performance, 'now')
      .mockImplementation(() => monotonicClock);

    const intervalCallbacks: Array<() => void> = [];
    const setIntervalSpy = vi
      .spyOn(window, 'setInterval')
      .mockImplementation(((cb: TimerHandler) => {
        if (typeof cb === 'function') {
          intervalCallbacks.push(cb as () => void);
        }
        return intervalCallbacks.length as unknown as number;
      }) as typeof window.setInterval);
    const clearIntervalSpy = vi
      .spyOn(window, 'clearInterval')
      .mockImplementation(() => undefined);

    try {
      const ninetyDaysMs = 90 * 24 * 60 * 60 * 1_000;
      const msgMs = Date.parse(MSG_NEW.created_at);
      // Anchor server time to 1 second before the 90-day boundary at monotonicClock = 1_000
      mockGetObservedServerTimeAnchor.mockReturnValue({
        serverMs: msgMs + ninetyDaysMs - 1_000,
        monotonicMs: 1_000,
      });

      mockListMentorConversations.mockResolvedValueOnce({
        items: [CONV_1],
        meta: { limit: 20, next_cursor: null },
      } satisfies PaginatedConversationsResponseDTO);
      mockGetMentorHistory.mockResolvedValueOnce({
        items: [MSG_NEW],
        meta: { limit: 20, next_cursor: null },
      } satisfies PaginatedMentorHistoryResponseDTO);

      render(<MentorChatView accessToken={TOKEN} aiMentorEnabled={true} />);

      // Fast browser wall clock must NOT evict server-confirmed retained message
      expect(
        await screen.findByText('Newest reply in thread'),
      ).toBeInTheDocument();

      // Browser wall clock jumping forward by 100 days while monotonic time stands still MUST NOT evict
      vi.setSystemTime(new Date('2028-03-10T12:00:00.000Z'));
      act(() => {
        for (const cb of intervalCallbacks) {
          cb();
        }
      });
      expect(screen.getByText('Newest reply in thread')).toBeInTheDocument();

      // Advance monotonic elapsed time by 2 seconds past the 90-day boundary -> periodic sweep evicts aged row
      monotonicClock = 3_000;
      act(() => {
        for (const cb of intervalCallbacks) {
          cb();
        }
      });

      await waitFor(() => {
        expect(
          screen.queryByText('Newest reply in thread'),
        ).not.toBeInTheDocument();
      });
    } finally {
      perfSpy.mockRestore();
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    }
  });

  it('scopes history retry ticks per conversation and preserves newly created conversation across same-account JWT refresh', async () => {
    const jwtUserA1 = `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify({ sub: 'user-same-1' }))}.sig1`;
    const jwtUserA2 = `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify({ sub: 'user-same-1' }))}.sig2`;

    mockListMentorConversations
      .mockResolvedValueOnce({
        items: [CONV_1, CONV_2],
        meta: { limit: 20, next_cursor: null },
      } satisfies PaginatedConversationsResponseDTO)
      .mockResolvedValueOnce({
        items: [CONV_1, CONV_2],
        meta: { limit: 20, next_cursor: null },
      } satisfies PaginatedConversationsResponseDTO);

    let conv2Calls = 0;
    mockGetMentorHistory.mockImplementation(
      async (_token: string, params: { conversation_id: string; cursor?: string }) => {
        if (params.conversation_id === CONV_1.id) {
          if (params.cursor === 'older-c1') {
            return {
              items: [MSG_OLD],
              meta: { limit: 20, next_cursor: null },
            };
          }
          return {
            items: [MSG_NEW],
            meta: { limit: 20, next_cursor: 'older-c1' },
          };
        }
        conv2Calls += 1;
        if (conv2Calls === 1) {
          throw new ApiError(503, 'Temporary error', 'SERVICE_UNAVAILABLE', 'req-h2', [], true);
        }
        return {
          items: [
            {
              id: 'm-c2-ok',
              role: 'assistant',
              content: 'Recovered Conv 2 history',
              language: 'en',
              created_at: '2026-11-24T09:00:00.000Z',
            },
          ],
          meta: { limit: 20, next_cursor: null },
        };
      },
    );

    let resolveCreate!: (conv: ConversationDTO) => void;
    mockCreateMentorConversation.mockImplementationOnce(
      () =>
        new Promise<ConversationDTO>((resolve) => {
          resolveCreate = resolve;
        }),
    );

    const { rerender } = render(
      <MentorChatView accessToken={jwtUserA1} aiMentorEnabled={true} />,
    );

    // 1. Load CONV_1 + older page
    expect(await screen.findByText('Newest reply in thread')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Load older messages/i }));
    expect(
      await screen.findByText('Older question from yesterday'),
    ).toBeInTheDocument();
    const conv1FetchCountBefore = mockGetMentorHistory.mock.calls.filter(
      (call) => (call[1] as { conversation_id: string }).conversation_id === CONV_1.id,
    ).length;

    // 2. Switch to CONV_2 -> fails -> Retry loading history -> recovers CONV_2
    const sidebar = screen.getByRole('complementary', {
      name: /Mentor conversations sidebar/i,
    });
    fireEvent.click(within(sidebar).getByRole('button', { name: /Career Switch Q&A/i }));
    fireEvent.click(
      await screen.findByRole('button', { name: /Retry loading history/i }),
    );
    expect(
      await screen.findByText('Recovered Conv 2 history'),
    ).toBeInTheDocument();

    // 3. Switch back to CONV_1 -> cached older page still intact, ZERO extra fetch
    fireEvent.click(
      within(sidebar).getByRole('button', { name: /Backend Focus Plan/i }),
    );
    expect(
      await screen.findByText('Older question from yesterday'),
    ).toBeInTheDocument();
    const conv1FetchCountAfter = mockGetMentorHistory.mock.calls.filter(
      (call) => (call[1] as { conversation_id: string }).conversation_id === CONV_1.id,
    ).length;
    expect(conv1FetchCountAfter).toBe(conv1FetchCountBefore);

    // 4. Start creating a new conversation, refresh JWT for the SAME account mid-flight -> still selects created thread
    fireEvent.click(
      within(sidebar).getByRole('button', { name: /General Career Chat/i }),
    );
    rerender(<MentorChatView accessToken={jwtUserA2} aiMentorEnabled={true} />);

    const createdFresh: ConversationDTO = {
      id: '99999999-9999-4999-8999-999999999999',
      context_type: 'general',
      roadmap_id: null,
      topic_id: null,
      title: 'Refreshed Session Thread',
      created_at: '2026-11-24T12:00:00.000Z',
    };
    await act(async () => {
      resolveCreate(createdFresh);
      await Promise.resolve();
    });

    expect(
      await within(sidebar).findByText('Refreshed Session Thread'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Refreshed Session Thread' }),
    ).toBeInTheDocument();
  });
});
