import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwksClient } from 'jwks-rsa';
import type { SupabaseJwtPayload } from '../interfaces/supabase-jwt-payload.interface.js';

/**
 * Passport JWT strategy that validates Supabase-issued tokens.
 *
 * Uses Supabase JWKS endpoint for asymmetric (ES256) signature validation.
 *
 * Validates:
 * - ES256 signatures
 * - Token expiry
 * - Issuer
 * - Audience ('authenticated')
 */
@Injectable()
export class SupabaseStrategy extends PassportStrategy(Strategy, 'supabase') {
  constructor(configService: ConfigService) {
    let supabaseUrl = configService.get<string>('SUPABASE_URL');
    if (!supabaseUrl) {
      throw new Error('SUPABASE_URL is not set. Cannot construct JWKS URI.');
    }
    // Normalize trailing slash
    supabaseUrl = supabaseUrl.replace(/\/$/, '');

    const jwksUrl =
      configService.get<string>('SUPABASE_JWKS_URL') ||
      `${supabaseUrl}/auth/v1/.well-known/jwks.json`;
    const issuer = `${supabaseUrl}/auth/v1`;

    const client = new JwksClient({
      cache: true,
      rateLimit: true,
      jwksRequestsPerMinute: 5,
      jwksUri: jwksUrl,
    });

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKeyProvider: async (
        request: any,
        rawJwtToken: string,
        done: any,
      ) => {
        try {
          const parts = rawJwtToken.split('.');
          if (parts.length !== 3) {
            return done(new Error('Invalid JWT format'));
          }
          const header = JSON.parse(Buffer.from(parts[0], 'base64').toString());
          const kid = header.kid;
          if (typeof kid !== 'string' || header.alg !== 'ES256')
            return done(new Error('Invalid JWT header'));

          const signingKey = await client.getSigningKey(kid);
          const publicKey = signingKey.getPublicKey();
          done(null, publicKey);
        } catch (err: any) {
          done(err);
        }
      },
      algorithms: ['ES256'],
      issuer: issuer,
      audience: 'authenticated',
    });
  }

  /**
   * Called after Passport verifies the signature and expiry.
   * Returns the payload fields our app needs; Passport attaches
   * this to req.user.
   */
  validate(payload: SupabaseJwtPayload) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        payload.sub,
      ) ||
      !payload.session_id ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        payload.session_id,
      ) ||
      !Number.isFinite(payload.exp) ||
      payload.exp <= Date.now() / 1000
    )
      throw new UnauthorizedException();
    return {
      sub: payload.sub,
      sessionId: payload.session_id,
      ...(Array.isArray(payload.amr) ? { amr: payload.amr } : {}),
    };
  }
}
