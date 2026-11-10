import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseService } from '../../auth/services/database.service.js';
import {
  MAX_OUTBOX_ATTEMPTS,
  OUTBOX_EXPIRY_MS,
  ProviderCleanupService,
} from './provider-cleanup.service.js';

describe('ProviderCleanupService (R35 Bounded Provider Cleanup Outbox)', () => {
  let mockQuery: ReturnType<typeof vi.fn>;
  let database: DatabaseService;
  let configService: ConfigService;
  let service: ProviderCleanupService;

  const TEST_REQUEST_ID = '11111111-1111-4111-8111-111111111111';
  const TEST_PROVIDER_KEY = 'google';
  const TEST_OBJECT_REF = 'google-oauth2|1234567890';

  beforeEach(() => {
    vi.clearAllMocks();

    mockQuery = vi.fn();
    database = {
      query: mockQuery,
      transaction: vi.fn(async (_u, op) => op({ query: mockQuery })),
    } as unknown as DatabaseService;

    configService = {
      get: vi.fn((key: string) => {
        if (key === 'NODE_ENV') return 'test';
        if (key === 'PROVIDER_CLEANUP_ENCRYPTION_KEY') {
          return '01234567890123456789012345678901'; // 32-byte valid key
        }
        return undefined;
      }),
    } as unknown as ConfigService;

    service = new ProviderCleanupService(configService, database);
  });

  describe('AEAD Encryption & Decryption (aes-256-gcm)', () => {
    it('encrypts and decrypts object reference roundtrip using requestId + providerKey as AAD', () => {
      const encrypted = service.encryptObjectRef(
        TEST_REQUEST_ID,
        TEST_PROVIDER_KEY,
        TEST_OBJECT_REF,
      );

      expect(encrypted).toMatch(/^v1:[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/i);

      const decrypted = service.decryptObjectRef(
        TEST_REQUEST_ID,
        TEST_PROVIDER_KEY,
        encrypted,
      );
      expect(decrypted).toBe(TEST_OBJECT_REF);
    });

    it('fails decryption when AAD requestId is mismatched (tamper proof)', () => {
      const encrypted = service.encryptObjectRef(
        TEST_REQUEST_ID,
        TEST_PROVIDER_KEY,
        TEST_OBJECT_REF,
      );

      const differentRequestId = '22222222-2222-4222-8222-222222222222';
      expect(() =>
        service.decryptObjectRef(
          differentRequestId,
          TEST_PROVIDER_KEY,
          encrypted,
        ),
      ).toThrowError();
    });

    it('fails decryption when AAD providerKey is mismatched (tamper proof)', () => {
      const encrypted = service.encryptObjectRef(
        TEST_REQUEST_ID,
        TEST_PROVIDER_KEY,
        TEST_OBJECT_REF,
      );

      expect(() =>
        service.decryptObjectRef(TEST_REQUEST_ID, 'facebook', encrypted),
      ).toThrowError();
    });

    it('fails decryption when ciphertext payload or auth tag is corrupted', () => {
      const encrypted = service.encryptObjectRef(
        TEST_REQUEST_ID,
        TEST_PROVIDER_KEY,
        TEST_OBJECT_REF,
      );

      const parts = encrypted.split(':');
      // Corrupt tag
      const corruptedTag =
        parts[0] +
        ':' +
        parts[1] +
        ':00000000000000000000000000000000:' +
        parts[3];
      expect(() =>
        service.decryptObjectRef(
          TEST_REQUEST_ID,
          TEST_PROVIDER_KEY,
          corruptedTag,
        ),
      ).toThrowError();
    });

    it('fails closed when encryption key is missing outside test/dev environments', () => {
      const prodConfig = {
        get: vi.fn((key: string) => {
          if (key === 'NODE_ENV') return 'production';
          return undefined; // no key configured
        }),
      } as unknown as ConfigService;

      const prodService = new ProviderCleanupService(prodConfig, database);
      expect(() =>
        prodService.encryptObjectRef(
          TEST_REQUEST_ID,
          TEST_PROVIDER_KEY,
          TEST_OBJECT_REF,
        ),
      ).toThrowError();
    });

    it('fails closed when encryption key is shorter than 32 bytes outside test/dev environments', () => {
      const prodConfig = {
        get: vi.fn((key: string) => {
          if (key === 'NODE_ENV') return 'production';
          if (key === 'PROVIDER_CLEANUP_ENCRYPTION_KEY') return 'short-secret';
          return undefined;
        }),
      } as unknown as ConfigService;

      const prodService = new ProviderCleanupService(prodConfig, database);
      expect(() =>
        prodService.encryptObjectRef(
          TEST_REQUEST_ID,
          TEST_PROVIDER_KEY,
          TEST_OBJECT_REF,
        ),
      ).toThrowError();
    });
  });

  describe('Outbox Entry Validation (R35 schema constraints)', () => {
    it('validates compliant pending outbox entry', () => {
      const encrypted = service.encryptObjectRef(
        TEST_REQUEST_ID,
        TEST_PROVIDER_KEY,
        TEST_OBJECT_REF,
      );

      const entry = service.validateCleanupEntry({
        provider_key: 'google',
        encrypted_object_ref: encrypted,
        attempts: 0,
        next_retry_at: new Date().toISOString(),
        state: 'pending',
      });

      expect(entry.provider_key).toBe('google');
      expect(entry.attempts).toBe(0);
      expect(entry.state).toBe('pending');
    });

    it('rejects unknown fields in outbox entry', () => {
      const encrypted = service.encryptObjectRef(
        TEST_REQUEST_ID,
        TEST_PROVIDER_KEY,
        TEST_OBJECT_REF,
      );

      expect(() =>
        service.validateCleanupEntry({
          provider_key: 'google',
          encrypted_object_ref: encrypted,
          attempts: 0,
          next_retry_at: new Date().toISOString(),
          state: 'pending',
          unknown_field: 'leak',
        }),
      ).toThrowError();
    });

    it('rejects plaintext references not matching AEAD format', () => {
      expect(() =>
        service.validateCleanupEntry({
          provider_key: 'google',
          encrypted_object_ref: 'raw_google_subject_12345',
          attempts: 0,
          next_retry_at: new Date().toISOString(),
          state: 'pending',
        }),
      ).toThrowError();
    });

    it('rejects state other than pending or failed', () => {
      const encrypted = service.encryptObjectRef(
        TEST_REQUEST_ID,
        TEST_PROVIDER_KEY,
        TEST_OBJECT_REF,
      );

      expect(() =>
        service.validateCleanupEntry({
          provider_key: 'google',
          encrypted_object_ref: encrypted,
          attempts: 0,
          next_retry_at: new Date().toISOString(),
          state: 'completed',
        }),
      ).toThrowError();
    });

    it('validates compliant failed tombstone entry without requiring encrypted ref', () => {
      const entry = service.validateCleanupEntry({
        provider: 'google',
        attempts: 5,
        state: 'failed',
      });

      expect(entry.provider_key).toBe('google');
      expect(entry.attempts).toBe(5);
      expect(entry.state).toBe('failed');
      expect(entry.encrypted_object_ref).toBeUndefined();
    });

    it('rejects attempts greater than 5', () => {
      const encrypted = service.encryptObjectRef(
        TEST_REQUEST_ID,
        TEST_PROVIDER_KEY,
        TEST_OBJECT_REF,
      );

      expect(() =>
        service.validateCleanupEntry({
          provider_key: 'google',
          encrypted_object_ref: encrypted,
          attempts: 6,
          next_retry_at: new Date().toISOString(),
          state: 'pending',
        }),
      ).toThrowError();
    });
  });

  describe('buildOutboxEntries', () => {
    it('returns empty array when providers list is empty', () => {
      expect(service.buildOutboxEntries(TEST_REQUEST_ID, [])).toEqual([]);
    });

    it('deduplicates providers and encrypts references', () => {
      const entries = service.buildOutboxEntries(TEST_REQUEST_ID, [
        { provider: 'google', providerSubject: 'sub-1' },
        { provider: 'google', providerSubject: 'sub-1-dup' },
        { provider: 'facebook', providerSubject: 'sub-2' },
      ]);

      expect(entries).toHaveLength(2);
      expect(entries[0].provider_key).toBe('google');
      expect(entries[0].attempts).toBe(0);
      expect(entries[0].state).toBe('pending');
      expect(entries[1].provider_key).toBe('facebook');
    });
  });

  describe('processOutboxBatch (Outbox Execution & Expiry)', () => {
    it('returns 0 metrics when no candidate deletion requests are found', async () => {
      mockQuery.mockResolvedValueOnce([]);

      const result = await service.processOutboxBatch({ batchSize: 5 });
      expect(result.processedRequests).toBe(0);
      expect(result.entriesAttempted).toBe(0);
    });

    it('scrubs expired entries when past 30-day deadline (R35)', async () => {
      const oldRequestedAt = new Date(Date.now() - (OUTBOX_EXPIRY_MS + 1000));
      const encrypted = service.encryptObjectRef(
        TEST_REQUEST_ID,
        TEST_PROVIDER_KEY,
        TEST_OBJECT_REF,
      );

      mockQuery
        .mockResolvedValueOnce([
          {
            id: TEST_REQUEST_ID,
            requested_at: oldRequestedAt,
            provider_cleanup: [
              {
                provider_key: 'google',
                encrypted_object_ref: encrypted,
                attempts: 1,
                next_retry_at: new Date().toISOString(),
                state: 'pending',
              },
            ],
            provider_cleanup_expires_at: oldRequestedAt,
            provider_deletion_requested: false,
          },
        ]) // candidate select
        .mockResolvedValueOnce([]); // scrub update

      const result = await service.processOutboxBatch({ batchSize: 5 });
      expect(result.processedRequests).toBe(1);
      expect(result.entriesExpired).toBe(1);

      // Verify scrub update query cleared provider_cleanup
      const updateCall = mockQuery.mock.calls.find(([sql]) =>
        String(sql).includes("SET provider_cleanup = '[]'::jsonb"),
      );
      expect(updateCall).toBeDefined();
    });

    it('successfully processes pending entry, removes it, and marks provider_deletion_requested = true when all accepted', async () => {
      const encrypted = service.encryptObjectRef(
        TEST_REQUEST_ID,
        TEST_PROVIDER_KEY,
        TEST_OBJECT_REF,
      );

      mockQuery
        .mockResolvedValueOnce([
          {
            id: TEST_REQUEST_ID,
            requested_at: new Date(),
            provider_cleanup: [
              {
                provider_key: 'google',
                encrypted_object_ref: encrypted,
                attempts: 0,
                next_retry_at: new Date(Date.now() - 1000).toISOString(),
                state: 'pending',
              },
            ],
            provider_cleanup_expires_at: new Date(
              Date.now() + OUTBOX_EXPIRY_MS,
            ),
            provider_deletion_requested: false,
          },
        ]) // select
        .mockResolvedValueOnce([]); // update row

      // Spy on dispatch
      vi.spyOn(service, 'dispatchProviderDeletion').mockResolvedValueOnce(true);

      const result = await service.processOutboxBatch({ batchSize: 5 });
      expect(result.processedRequests).toBe(1);
      expect(result.entriesAttempted).toBe(1);
      expect(result.entriesSucceeded).toBe(1);

      const updateCall = mockQuery.mock.calls.find(([sql]) =>
        String(sql).includes('provider_deletion_requested = CASE'),
      );
      expect(updateCall).toBeDefined();
      expect(updateCall?.[1]?.[0]).toBe(TEST_REQUEST_ID);
      expect(updateCall?.[1]?.[1]).toBe(true);
    });

    it('handles provider call failure by incrementing attempts and setting exponential backoff', async () => {
      const encrypted = service.encryptObjectRef(
        TEST_REQUEST_ID,
        TEST_PROVIDER_KEY,
        TEST_OBJECT_REF,
      );

      mockQuery
        .mockResolvedValueOnce([
          {
            id: TEST_REQUEST_ID,
            requested_at: new Date(),
            provider_cleanup: [
              {
                provider_key: 'google',
                encrypted_object_ref: encrypted,
                attempts: 1,
                next_retry_at: new Date(Date.now() - 1000).toISOString(),
                state: 'pending',
              },
            ],
            provider_cleanup_expires_at: new Date(
              Date.now() + OUTBOX_EXPIRY_MS,
            ),
            provider_deletion_requested: false,
          },
        ]) // select
        .mockResolvedValueOnce([]); // update with backoff

      vi.spyOn(service, 'dispatchProviderDeletion').mockResolvedValueOnce(
        false,
      );

      const result = await service.processOutboxBatch({ batchSize: 5 });
      expect(result.processedRequests).toBe(1);
      expect(result.entriesAttempted).toBe(1);
      expect(result.entriesFailed).toBe(1);

      // Verify row updated with updated attempt count (2)
      const updateCall = mockQuery.mock.calls.find(([sql]) =>
        String(sql).includes('SET provider_cleanup = $2::jsonb'),
      );
      expect(updateCall).toBeDefined();
      const updatedEntries = JSON.parse(updateCall?.[1]?.[1] as string);
      expect(updatedEntries[0].attempts).toBe(2);
      const nextRetryTime = new Date(updatedEntries[0].next_retry_at).getTime();
      // Backoff schedule 2^2 * 60s = 4 min = 240,000 ms
      expect(nextRetryTime).toBeGreaterThanOrEqual(Date.now() + 230_000);
    });

    it('exhausts entry after 5 attempts and persists failed tombstone without setting provider_deletion_requested', async () => {
      const encrypted = service.encryptObjectRef(
        TEST_REQUEST_ID,
        TEST_PROVIDER_KEY,
        TEST_OBJECT_REF,
      );

      mockQuery
        .mockResolvedValueOnce([
          {
            id: TEST_REQUEST_ID,
            requested_at: new Date(),
            provider_cleanup: [
              {
                provider_key: 'google',
                encrypted_object_ref: encrypted,
                attempts: MAX_OUTBOX_ATTEMPTS,
                next_retry_at: new Date(Date.now() - 1000).toISOString(),
                state: 'pending',
              },
            ],
            provider_cleanup_expires_at: new Date(
              Date.now() + OUTBOX_EXPIRY_MS,
            ),
            provider_deletion_requested: false,
          },
        ]) // select
        .mockResolvedValueOnce([]); // update row

      const result = await service.processOutboxBatch({ batchSize: 5 });
      expect(result.processedRequests).toBe(1);
      expect(result.entriesAttempted).toBe(0); // already at 5 attempts, skipped
      expect(result.entriesFailed).toBe(1); // exhausted

      const updateCall = mockQuery.mock.calls.find(([sql]) =>
        String(sql).includes('SET provider_cleanup = $2::jsonb'),
      );
      expect(updateCall).toBeDefined();
      const savedEntries = JSON.parse(updateCall?.[1]?.[1]);
      expect(savedEntries).toHaveLength(1);
      expect(savedEntries[0]).toMatchObject({
        provider_key: 'google',
        state: 'failed',
        attempts: MAX_OUTBOX_ATTEMPTS,
      });

      // provider_deletion_requested is never flipped to true
      expect(mockQuery).not.toHaveBeenCalledWith(
        expect.stringContaining('provider_deletion_requested = CASE'),
        [TEST_REQUEST_ID, true],
      );
    });

    it('sets provider_deletion_requested = false for mixed provider outcomes (one succeeds, one exhausts)', async () => {
      const encrypted1 = service.encryptObjectRef(
        TEST_REQUEST_ID,
        'google',
        'sub-1',
      );
      const encrypted2 = service.encryptObjectRef(
        TEST_REQUEST_ID,
        'facebook',
        'sub-2',
      );

      mockQuery
        .mockResolvedValueOnce([
          {
            id: TEST_REQUEST_ID,
            requested_at: new Date(),
            provider_cleanup: [
              {
                provider_key: 'google',
                encrypted_object_ref: encrypted1,
                attempts: 0,
                next_retry_at: new Date(Date.now() - 1000).toISOString(),
                state: 'pending',
              },
              {
                provider_key: 'facebook',
                encrypted_object_ref: encrypted2,
                attempts: MAX_OUTBOX_ATTEMPTS,
                next_retry_at: new Date(Date.now() - 1000).toISOString(),
                state: 'pending',
              },
            ],
            provider_cleanup_expires_at: new Date(
              Date.now() + OUTBOX_EXPIRY_MS,
            ),
            provider_deletion_requested: false,
          },
        ]) // select
        .mockResolvedValueOnce([]); // update row

      vi.spyOn(service, 'dispatchProviderDeletion').mockResolvedValueOnce(true);

      const result = await service.processOutboxBatch({ batchSize: 5 });
      expect(result.processedRequests).toBe(1);
      expect(result.entriesSucceeded).toBe(1);
      expect(result.entriesFailed).toBe(1);

      const updateCall = mockQuery.mock.calls.find(([sql]) =>
        String(sql).includes('SET provider_cleanup = $2::jsonb'),
      );
      expect(updateCall).toBeDefined();
      const savedEntries = JSON.parse(updateCall?.[1]?.[1]);
      expect(savedEntries).toHaveLength(1);
      expect(savedEntries[0]).toMatchObject({
        provider_key: 'facebook',
        state: 'failed',
        attempts: MAX_OUTBOX_ATTEMPTS,
      });

      // provider_deletion_requested is never flipped to true
      expect(mockQuery).not.toHaveBeenCalledWith(
        expect.stringContaining('provider_deletion_requested = CASE'),
        [TEST_REQUEST_ID, true],
      );
    });

    it('persists failed outbox tombstone across runs and keeps provider_deletion_requested false', async () => {
      const encryptedA = service.encryptObjectRef(
        TEST_REQUEST_ID,
        'facebook',
        'sub-a',
      );
      const encryptedB = service.encryptObjectRef(
        TEST_REQUEST_ID,
        'google',
        'sub-b',
      );

      // --- RUN 1 ---
      // Entry A exhausts attempts (attempts: MAX_OUTBOX_ATTEMPTS, due now)
      // Entry B is not yet due (next_retry_at: 10 minutes in future, state: 'pending')
      const futureRetry = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const run1Cleanup = [
        {
          provider_key: 'facebook',
          provider: 'facebook',
          encrypted_object_ref: encryptedA,
          attempts: MAX_OUTBOX_ATTEMPTS,
          next_retry_at: new Date(Date.now() - 1000).toISOString(),
          state: 'pending',
        },
        {
          provider_key: 'google',
          provider: 'google',
          encrypted_object_ref: encryptedB,
          attempts: 0,
          next_retry_at: futureRetry,
          state: 'pending',
        },
      ];

      mockQuery
        .mockResolvedValueOnce([
          {
            id: TEST_REQUEST_ID,
            requested_at: new Date(),
            provider_cleanup: run1Cleanup,
            provider_cleanup_expires_at: new Date(
              Date.now() + OUTBOX_EXPIRY_MS,
            ),
            provider_deletion_requested: false,
          },
        ]) // select run 1
        .mockResolvedValueOnce([]); // update run 1

      const result1 = await service.processOutboxBatch({ batchSize: 5 });
      expect(result1.processedRequests).toBe(1);
      expect(result1.entriesFailed).toBe(1);

      // Verify Run 1 saved provider_cleanup with Entry A failed tombstone + Entry B pending
      const run1UpdateCall = mockQuery.mock.calls.find(([sql]) =>
        String(sql).includes('SET provider_cleanup = $2::jsonb'),
      );
      expect(run1UpdateCall).toBeDefined();
      const run1SavedEntries = JSON.parse(run1UpdateCall?.[1]?.[1]);
      expect(run1SavedEntries).toHaveLength(2);
      expect(run1SavedEntries[0]).toMatchObject({
        provider_key: 'facebook',
        state: 'failed',
        attempts: MAX_OUTBOX_ATTEMPTS,
      });
      expect(run1SavedEntries[1]).toMatchObject({
        provider_key: 'google',
        state: 'pending',
        attempts: 0,
      });
      // provider_deletion_requested was not set to true
      expect(mockQuery).not.toHaveBeenCalledWith(
        expect.stringContaining('provider_deletion_requested = CASE'),
        [TEST_REQUEST_ID, true],
      );

      // --- RUN 2 ---
      // Feed saved provider_cleanup into Run 2 where Entry B is now due and succeeds
      mockQuery.mockClear();
      const run2Cleanup = [
        run1SavedEntries[0], // Entry A: failed tombstone
        {
          ...run1SavedEntries[1], // Entry B: now due
          next_retry_at: new Date(Date.now() - 1000).toISOString(),
        },
      ];

      mockQuery
        .mockResolvedValueOnce([
          {
            id: TEST_REQUEST_ID,
            requested_at: new Date(),
            provider_cleanup: run2Cleanup,
            provider_cleanup_expires_at: new Date(
              Date.now() + OUTBOX_EXPIRY_MS,
            ),
            provider_deletion_requested: false,
          },
        ]) // select run 2
        .mockResolvedValueOnce([]); // update run 2

      vi.spyOn(service, 'dispatchProviderDeletion').mockResolvedValueOnce(true);

      const result2 = await service.processOutboxBatch({ batchSize: 5 });
      expect(result2.processedRequests).toBe(1);
      expect(result2.entriesSucceeded).toBe(1);

      // Verify Run 2: Entry B succeeded and was removed, Entry A failed tombstone remains
      const run2UpdateCall = mockQuery.mock.calls.find(([sql]) =>
        String(sql).includes('SET provider_cleanup = $2::jsonb'),
      );
      expect(run2UpdateCall).toBeDefined();
      const run2SavedEntries = JSON.parse(run2UpdateCall?.[1]?.[1]);
      expect(run2SavedEntries).toHaveLength(1);
      expect(run2SavedEntries[0]).toMatchObject({
        provider_key: 'facebook',
        state: 'failed',
        attempts: MAX_OUTBOX_ATTEMPTS,
      });

      // provider_deletion_requested was NEVER flipped to true
      expect(mockQuery).not.toHaveBeenCalledWith(
        expect.stringContaining('provider_deletion_requested = CASE'),
        [TEST_REQUEST_ID, true],
      );
    });

    it('exercises dispatchProviderDeletion: missing config, URL encoding, and unconfigured providers return false', async () => {
      const originalFetch = global.fetch;
      const mockFetch = vi.fn();
      vi.stubGlobal('fetch', mockFetch);

      // 1. Missing service key returns false
      const resMissingConfig = await service.dispatchProviderDeletion(
        'supabase',
        'user-ref-123',
      );
      expect(resMissingConfig).toBe(false);

      // 2. Unconfigured provider (e.g. google / facebook without live adapter) returns false
      const resUnconfigured = await service.dispatchProviderDeletion(
        'google',
        'google-sub-456',
      );
      expect(resUnconfigured).toBe(false);

      // 3. Configured supabase admin deletion properly URL-encodes user ref
      vi.spyOn(configService, 'get').mockImplementation((key: string) => {
        if (key === 'SUPABASE_URL') return 'http://127.0.0.1:54321';
        if (key === 'SUPABASE_SERVICE_ROLE_KEY') return 'test-service-key';
        return undefined;
      });
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

      const resSupabase = await service.dispatchProviderDeletion(
        'supabase',
        'auth0|special/user@test',
      );
      expect(resSupabase).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:54321/auth/v1/admin/users/auth0%7Cspecial%2Fuser%40test',
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-service-key',
          }),
        }),
      );

      vi.stubGlobal('fetch', originalFetch);
    });

    it('aborts processOutboxBatch with 503 and zero UPDATE queries when encryption key is misconfigured in production', async () => {
      vi.spyOn(configService, 'get').mockImplementation((key: string) => {
        if (key === 'NODE_ENV') return 'production';
        if (key === 'PROVIDER_CLEANUP_ENCRYPTION_KEY') return undefined;
        return undefined;
      });

      await expect(
        service.processOutboxBatch({ batchSize: 5 }),
      ).rejects.toMatchObject({
        status: 503,
      });

      const updateCalls = mockQuery.mock.calls.filter(([sql]) =>
        String(sql).toUpperCase().includes('UPDATE'),
      );
      expect(updateCalls).toHaveLength(0);
    });

    it('persists normalized failed tombstone for row with only malformed entries before skipping dispatch', async () => {
      const malformedRow = {
        id: TEST_REQUEST_ID,
        requested_at: new Date(),
        provider_cleanup: [
          {
            provider: 'google',
            state: 'pending',
            attempts: 99,
          },
        ],
        provider_cleanup_expires_at: new Date(Date.now() + OUTBOX_EXPIRY_MS),
        provider_deletion_requested: false,
      };

      mockQuery.mockResolvedValueOnce([malformedRow]).mockResolvedValueOnce([]);

      const dispatchSpy = vi.spyOn(service, 'dispatchProviderDeletion');

      const result = await service.processOutboxBatch({ batchSize: 5 });

      expect(result.processedRequests).toBe(1);
      expect(result.entriesAttempted).toBe(0);
      expect(dispatchSpy).not.toHaveBeenCalled();

      const updateCall = mockQuery.mock.calls.find(([sql]) =>
        String(sql).includes('SET provider_cleanup = $2::jsonb'),
      );
      expect(updateCall).toBeDefined();
      expect(updateCall?.[1]?.[0]).toBe(TEST_REQUEST_ID);
      const savedEntries = JSON.parse(updateCall?.[1]?.[1]);
      expect(savedEntries).toHaveLength(1);
      expect(savedEntries[0]).toMatchObject({
        provider_key: 'google',
        provider: 'google',
        state: 'failed',
        attempts: 99,
      });
    });

    it('always enqueues supabase entry using userId, excludes email/phone, and executes supabase deletion path alongside external providers', async () => {
      const originalFetch = global.fetch;
      const mockFetch = vi.fn();
      vi.stubGlobal('fetch', mockFetch);

      vi.spyOn(configService, 'get').mockImplementation((key: string) => {
        if (key === 'NODE_ENV') return 'test';
        if (key === 'PROVIDER_CLEANUP_ENCRYPTION_KEY') {
          return '01234567890123456789012345678901';
        }
        if (key === 'SUPABASE_URL') return 'http://127.0.0.1:54321';
        if (key === 'SUPABASE_SERVICE_ROLE_KEY') return 'test-service-key';
        return undefined;
      });

      const TEST_USER_ID = '99999999-9999-4999-8999-999999999999';

      // 1. buildOutboxEntries enqueues supabase entry and skips email/phone
      const entries = service.buildOutboxEntries(
        TEST_REQUEST_ID,
        TEST_USER_ID,
        [
          { provider: 'email', providerSubject: 'user@example.com' },
          { provider: 'phone', providerSubject: '+8801700000000' },
          { provider: 'google', providerSubject: 'google-sub-456' },
        ],
      );

      expect(entries).toHaveLength(2);
      expect(entries[0].provider_key).toBe('supabase');
      expect(entries[1].provider_key).toBe('google');

      // 2. Feed real entries into processOutboxBatch
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

      mockQuery
        .mockResolvedValueOnce([
          {
            id: TEST_REQUEST_ID,
            requested_at: new Date(),
            provider_cleanup: entries,
            provider_cleanup_expires_at: new Date(
              Date.now() + OUTBOX_EXPIRY_MS,
            ),
            provider_deletion_requested: false,
          },
        ])
        .mockResolvedValueOnce([]);

      const result = await service.processOutboxBatch({ batchSize: 5 });

      expect(result.processedRequests).toBe(1);
      expect(result.entriesSucceeded).toBe(1);
      expect(result.entriesFailed).toBe(1);

      expect(mockFetch).toHaveBeenCalledWith(
        `http://127.0.0.1:54321/auth/v1/admin/users/${TEST_USER_ID}`,
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-service-key',
          }),
        }),
      );

      vi.stubGlobal('fetch', originalFetch);
    });
  });
});
