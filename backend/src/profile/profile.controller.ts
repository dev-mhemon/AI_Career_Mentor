import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Req,
  HttpCode,
  UseGuards,
} from '@nestjs/common';
import { AccessGuard } from '../auth/guards/access.guard.js';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard.js';
import { Policy } from '../auth/policy.js';
import { ProfileService } from './profile.service.js';
import {
  AliasInput,
  LearningPatch,
  PreferencesPatch,
  ProfilePatch,
} from './profile.dto.js';

@Controller()
@UseGuards(SupabaseAuthGuard, AccessGuard)
@Policy({})
export class ProfileController {
  constructor(private readonly profiles: ProfileService) {}
  @Get('profile') read(@Req() req: any) {
    return this.profiles.read(req.user.sub);
  }
  @Patch('profile') patch(@Req() req: any, @Body() input: ProfilePatch) {
    return this.profiles.patch(req.user.sub, input);
  }
  @Patch('profile/preferences') preferences(
    @Req() req: any,
    @Body() input: PreferencesPatch,
  ) {
    return this.profiles.preferences(req.user.sub, input);
  }
  @Patch('profile/learning-settings') learning(
    @Req() req: any,
    @Body() input: LearningPatch,
  ) {
    return this.profiles.learning(req.user.sub, input);
  }
  @Post('profile/skill-alias-interpretations')
  @HttpCode(201)
  alias(@Req() req: any, @Body() input: AliasInput) {
    return this.profiles.alias(req.user.sub, input);
  }
}
