import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { AuthService } from '../services/auth.service.js';
import { Policy } from '../policy.js';
import { OAuthSession } from '../../profile/profile.dto.js';
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  /** Transitional adapter used by the existing email/phone UI; not an additional C05 catalog claim. */
  @Post('sync')
  @HttpCode(200)
  @Policy({ bootstrap: true })
  sync(@Req() req: any) {
    return this.auth.bootstrap(req.user, req.headers.authorization);
  }
  @Post('oauth/session')
  @HttpCode(200)
  @Policy({ bootstrap: true })
  async oauth(@Req() req: any, @Body() input: OAuthSession) {
    const me = await this.auth.bootstrap(
      req.user,
      req.headers.authorization,
      input.provider,
    );
    return {
      user: me.user,
      profile_complete: me.profile_complete,
      verified_contact_required: !me.user.verified_contact,
      next_step: !me.user.verified_contact
        ? 'add_verified_contact'
        : me.profile_complete
          ? 'app_home'
          : 'profile_setup',
    };
  }
  @Get('me')
  @Policy({ allowSuspended: true })
  me(@Req() req: any) {
    return this.auth.me(req.user.sub);
  }
}
