import { ConfigService } from '@nestjs/config';
import { SupabaseStrategy } from './supabase.strategy.js';
import type { SupabaseJwtPayload } from '../interfaces/supabase-jwt-payload.interface.js';

describe('SupabaseStrategy', () => {
  it('should throw if SUPABASE_JWT_SECRET is not set', () => {
    const configService = {
      get: vi.fn().mockReturnValue(undefined),
    } as unknown as ConfigService;

    expect(() => new SupabaseStrategy(configService)).toThrow(
      'SUPABASE_JWT_SECRET is not set',
    );
  });

  it('should construct successfully with a valid secret', () => {
    const configService = {
      get: vi.fn().mockReturnValue('test-secret-at-least-32-chars-long'),
    } as unknown as ConfigService;

    expect(() => new SupabaseStrategy(configService)).not.toThrow();
  });

  it('should extract supabase_uid, email, and phone from payload', () => {
    const configService = {
      get: vi.fn().mockReturnValue('test-secret-at-least-32-chars-long'),
    } as unknown as ConfigService;

    const strategy = new SupabaseStrategy(configService);
    const payload: SupabaseJwtPayload = {
      sub: 'supa-uid-1',
      email: 'test@example.com',
      phone: '+1234567890',
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
    };

    const result = strategy.validate(payload);

    expect(result).toEqual({
      supabase_uid: 'supa-uid-1',
      email: 'test@example.com',
      phone: '+1234567890',
    });
  });

  it('should default email and phone to null when absent', () => {
    const configService = {
      get: vi.fn().mockReturnValue('test-secret-at-least-32-chars-long'),
    } as unknown as ConfigService;

    const strategy = new SupabaseStrategy(configService);
    const payload: SupabaseJwtPayload = {
      sub: 'supa-uid-2',
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
    };

    const result = strategy.validate(payload);

    expect(result).toEqual({
      supabase_uid: 'supa-uid-2',
      email: null,
      phone: null,
    });
  });
});
