import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  HttpCode,
} from '@nestjs/common';
import { Policy } from '../auth/policy.js';
import { ProfileService } from './profile.service.js';
import {
  AliasInput,
  ConfirmGoal,
  LearningPatch,
  PreferencesPatch,
  ProfilePatch,
} from './profile.dto.js';
@Controller()
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
  @Post('profile/skill-alias-interpretations') alias(
    @Req() req: any,
    @Body() input: AliasInput,
  ) {
    return this.profiles.alias(req.user.sub, input);
  }
  @Get('career/goals/:id') goal(
    @Req() req: any,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 400 })) id: string,
  ) {
    return this.profiles.readGoal(req.user.sub, id);
  }
  @Post('career/goals/:id/confirm')
  @HttpCode(200)
  @Policy({ feature: 'roadmap_generator' })
  confirm(
    @Req() req: any,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 400 })) id: string,
    @Body() input: ConfirmGoal,
  ) {
    return this.profiles.confirm(req.user.sub, id, input);
  }
}
