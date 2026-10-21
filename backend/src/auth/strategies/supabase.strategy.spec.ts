import { ConfigService } from '@nestjs/config';
import { SupabaseStrategy } from './supabase.strategy.js';
import type { SupabaseJwtPayload } from '../interfaces/supabase-jwt-payload.interface.js';

describe('SupabaseStrategy', () => {
  it('should throw if SUPABASE_URL is not set', () => {
    const configService = {
      get: vi.fn().mockReturnValue(undefined),
    } as unknown as ConfigService;

    expect(() => new SupabaseStrategy(configService)).toThrow(
      'SUPABASE_URL is not set',
    );
  });

  it('should construct successfully with a valid SUPABASE_URL', () => {
    const configService = {
      get: vi.fn((key: string) => {
        if (key === 'SUPABASE_URL') return 'https://test.supabase.co';
        return undefined;
      }),
    } as unknown as ConfigService;

    expect(() => new SupabaseStrategy(configService)).not.toThrow();
  });

  it('returns only verified subject, never contact claims', () => {
    const configService = {
      get: vi.fn((key: string) => {
        if (key === 'SUPABASE_URL') return 'https://test.supabase.co';
        return undefined;
      }),
    } as unknown as ConfigService;

    const strategy = new SupabaseStrategy(configService);
    const payload: SupabaseJwtPayload = {
      sub: '11111111-1111-4111-8111-111111111111',
      email: 'test@example.com',
      phone: '+1234567890',
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
    };

    const result = strategy.validate(payload);

    expect(result).toEqual({ sub: payload.sub });
  });

  it('accepts the subject without contact claims', () => {
    const configService = {
      get: vi.fn((key: string) => {
        if (key === 'SUPABASE_URL') return 'https://test.supabase.co';
        return undefined;
      }),
    } as unknown as ConfigService;

    const strategy = new SupabaseStrategy(configService);
    const payload: SupabaseJwtPayload = {
      sub: '22222222-2222-4222-8222-222222222222',
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
    };

    const result = strategy.validate(payload);

    expect(result).toEqual({ sub: payload.sub });
  });
});
