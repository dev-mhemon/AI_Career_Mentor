import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { SupabaseJwtPayload } from '../interfaces/supabase-jwt-payload.interface.js';

/**
 * Passport JWT strategy that validates Supabase-issued tokens.
 *
 * Plan v1.2 §5: JWT validation uses the Supabase project JWT secret
 * (symmetric HMAC-SHA256). Passport handles expiry and signature
 * checks automatically — invalid or expired tokens produce 401.
 *
 * The validate() return value is attached to req.user. For /sync this
 * is the raw JWT payload (no DB lookup required). For other endpoints
 * the guards or controller resolve the full User entity.
 */
@Injectable()
export class SupabaseStrategy extends PassportStrategy(Strategy, 'supabase') {
  constructor(configService: ConfigService) {
    const secret = configService.get<string>('SUPABASE_JWT_SECRET');
    if (!secret) {
      throw new Error(
        'SUPABASE_JWT_SECRET is not set. Cannot validate Supabase JWTs.',
      );
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
      algorithms: ['HS256'],
    });
  }

  /**
   * Called after Passport verifies the signature and expiry.
   * Returns the payload fields our app needs; Passport attaches
   * this to req.user.
   */
  validate(payload: SupabaseJwtPayload) {
    return {
      supabase_uid: payload.sub,
      email: payload.email ?? null,
      phone: payload.phone ?? null,
    };
  }
}
