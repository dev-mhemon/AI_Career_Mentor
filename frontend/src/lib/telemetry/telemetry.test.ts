import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearTelemetryEvents,
  consumePendingTelemetryRotation,
  getTelemetryEvents,
  getTelemetrySessionId,
  markTelemetrySignInPending,
  rotateTelemetrySessionId,
  setTelemetrySink,
  trackEvent,
  type TelemetryEventName,
} from './telemetry';

describe('Privacy-Filtered Telemetry (C09 §7, R11)', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    clearTelemetryEvents();
    setTelemetrySink(null);
  });

  it('generates, persists, and rotates non-PII UUID anonymous_session_id in sessionStorage', () => {
    const first = getTelemetrySessionId();
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(getTelemetrySessionId()).toBe(first);

    const rotated = rotateTelemetrySessionId();
    expect(rotated).not.toBe(first);
    expect(getTelemetrySessionId()).toBe(rotated);
  });

  it('emits allowlisted events with required C09 §7.1 envelope and rejects unknown event names', () => {
    const sink = vi.fn();
    setTelemetrySink(sink);

    const reqId = '11111111-1111-4111-8111-111111111111';
    const emitted = trackEvent({
      event_name: 'career_goal_submitted',
      feature_key: 'onboarding',
      screen_name: 'onboarding_goal',
      request_id: reqId,
      metadata: {
        step: 1,
        channel: 'email',
        status_code: 201,
        source: 'roadmap_draft',
        screen_name: 'career_profile',
        feature_key: 'roadmap_generator',
        error_code: 'RATE_LIMITED',
        request_id: 'req_abc12345_xyz',
      },
    });

    expect(emitted).not.toBeNull();
    expect(emitted).toMatchObject({
      feature_key: 'onboarding',
      screen_name: 'onboarding_goal',
      event_name: 'career_goal_submitted',
      request_id: reqId,
      metadata: {
        step: 1,
        channel: 'email',
        status_code: 201,
        source: 'roadmap_draft',
        screen_name: 'career_profile',
        feature_key: 'roadmap_generator',
        error_code: 'RATE_LIMITED',
        request_id: 'req_abc12345_xyz',
      },
    });
    expect(Number.isNaN(Date.parse(emitted!.timestamp))).toBe(false);
    expect(sink).toHaveBeenCalledTimes(1);

    const rejected = trackEvent({
      event_name: 'unlisted_event' as TelemetryEventName,
      feature_key: 'auth',
      screen_name: 'login',
    });
    expect(rejected).toBeNull();
    expect(getTelemetryEvents()).toHaveLength(1);
  });

  it('strictly enforces field-specific value allowlists, stripping disguised phone tokens, unlisted keys, free text, and PII (C09 §7.2 / R11)', () => {
    const emitted = trackEvent({
      event_name: 'mentor_message_sent',
      feature_key: 'ai_mentor',
      screen_name: 'mentor',
      request_id: 'not-a-uuid-secret-token',
      metadata: {
        detail: 'My private mentor message',
        contact_number: 8801712345678,
        content: 'My private mentor message',
        goal_text: 'I want to become a Staff Engineer',
        answer_text: 'SELECT * FROM users;',
        password: 'MySecretPassword1!',
        otp: '123456',
        access_token: 'eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiIxMjMifQ.sig',
        email: 'learner@example.com',
        phone: '+8801712345678',
        channel: 'call +8801812345678 now',
        source: '01712-345678',
        screen_name: '01712-345678',
        feature_key: 'custom_unlisted_feature',
        reason_code: 'CONTACT_01712_345678',
        request_id: 'req_01712_345678',
        status_code: 999,
        error_code: 'RATE_LIMITED',
        step: 3,
      },
    });

    expect(emitted).not.toBeNull();
    expect(emitted!.request_id).toBeUndefined();
    expect(emitted!.metadata).toEqual({
      error_code: 'RATE_LIMITED',
      step: 3,
    });
    const raw = JSON.stringify(emitted);
    expect(raw).not.toContain('private mentor');
    expect(raw).not.toContain('Staff Engineer');
    expect(raw).not.toContain('SELECT *');
    expect(raw).not.toContain('learner@example.com');
    expect(raw).not.toContain('8801712345678');
    expect(raw).not.toContain('01712-345678');
    expect(raw).not.toContain('01712_345678');
    expect(raw).not.toContain('eyJhbGci');
  });

  it('rotates anonymous_session_id once when consuming pending OAuth sign-in rotation marker', () => {
    const beforeOAuth = getTelemetrySessionId();
    expect(consumePendingTelemetryRotation()).toBeNull();

    markTelemetrySignInPending();
    const afterOAuth = consumePendingTelemetryRotation();
    expect(afterOAuth).not.toBeNull();
    expect(afterOAuth).not.toBe(beforeOAuth);
    expect(getTelemetrySessionId()).toBe(afterOAuth);

    // Second call is a no-op because the marker was consumed.
    expect(consumePendingTelemetryRotation()).toBeNull();
    expect(getTelemetrySessionId()).toBe(afterOAuth);
  });

  it('caps in-memory buffer at 100 events', () => {
    for (let i = 0; i < 120; i += 1) {
      trackEvent({
        event_name: 'page_viewed',
        feature_key: 'daily_plan',
        screen_name: 'today',
        request_id: `req_event_${String(i).padStart(4, '0')}`,
      });
    }
    const events = getTelemetryEvents();
    expect(events).toHaveLength(100);
    expect(events[0]?.request_id).toBe('req_event_0020');
    expect(events[99]?.request_id).toBe('req_event_0119');
  });

  it('keeps rotated in-memory session authoritative when sessionStorage.setItem throws while getItem returns stale UUID', () => {
    const staleUuid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    window.sessionStorage.setItem(
      'acm:telemetry:anonymous_session_id',
      staleUuid,
    );
    expect(getTelemetrySessionId()).toBe(staleUuid);

    const setItemSpy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });

    let rotatedUuid = '';
    try {
      rotatedUuid = rotateTelemetrySessionId();
      expect(rotatedUuid).not.toBe(staleUuid);
      // Subsequent reads and events MUST keep the rotated in-memory UUID instead of reading stale storage.
      expect(getTelemetrySessionId()).toBe(rotatedUuid);
      const emitted = trackEvent({
        event_name: 'auth_login_submitted',
        feature_key: 'auth',
        screen_name: 'login',
      });
      expect(emitted?.anonymous_session_id).toBe(rotatedUuid);
    } finally {
      setItemSpy.mockRestore();
    }

    // Restores storage authority once a subsequent setItem succeeds.
    const nextUuid = rotateTelemetrySessionId();
    expect(nextUuid).not.toBe(rotatedUuid);
    expect(
      window.sessionStorage.getItem('acm:telemetry:anonymous_session_id'),
    ).toBe(nextUuid);
    expect(getTelemetrySessionId()).toBe(nextUuid);
  });

  it('contains throwing custom telemetry sinks without throwing from trackEvent()', () => {
    setTelemetrySink(() => {
      throw new Error('Sink transport exploded');
    });

    const emitted = trackEvent({
      event_name: 'roadmap_activated',
      feature_key: 'roadmap_generator',
      screen_name: 'roadmap_draft',
      metadata: { status_code: 200 },
    });

    expect(emitted).not.toBeNull();
    expect(emitted?.event_name).toBe('roadmap_activated');
    expect(getTelemetryEvents()).toHaveLength(1);
  });

  it('never throws when sessionStorage and crypto.randomUUID throw (non-throwing contract)', () => {
    const getItemSpy = vi
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new Error('SecurityError: storage denied');
      });
    const setItemSpy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('SecurityError: storage denied');
      });
    const randomUuidSpy = vi
      .spyOn(globalThis.crypto, 'randomUUID')
      .mockImplementation(() => {
        throw new Error('randomUUID unavailable');
      });

    try {
      const id = rotateTelemetrySessionId();
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      const emitted = trackEvent({
        event_name: 'auth_login_submitted',
        feature_key: 'auth',
        screen_name: 'login',
      });
      expect(emitted).not.toBeNull();
      expect(emitted?.anonymous_session_id).toBe(id);
    } finally {
      getItemSpy.mockRestore();
      setItemSpy.mockRestore();
      randomUuidSpy.mockRestore();
      // Restore storage authority for subsequent tests.
      rotateTelemetrySessionId();
    }
  });
});
