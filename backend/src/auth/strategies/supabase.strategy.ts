import { Injectable, Logger } from '@nestjs/common';
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
  private readonly logger = new Logger(SupabaseStrategy.name);

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
          let kid = header.kid;

          if (!kid) {
            // If Supabase token lacks a kid, fetch keys and use the first one
            const keys = (await client.getKeys()) as any[];
            if (!keys || keys.length === 0) {
              return done(new Error('No keys found in Supabase JWKS'));
            }
            kid = keys[0].kid;
          }

          const signingKey = await client.getSigningKey(kid);
          const publicKey = signingKey.getPublicKey();
          done(null, publicKey);
        } catch (err: any) {
          const statusCode = err.status || err.statusCode || 'unknown';
          this.logger.error(
            `JWKS Fetch Error (HTTP Status: ${statusCode}) - ${err.message}`,
          );
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
    return {
      supabase_uid: payload.sub,
      email: payload.email ?? null,
      phone: payload.phone ?? null,
    };
  }
}
