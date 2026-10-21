import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ProfilePatch, LearningPatch, AliasInput } from './profile.dto.js';
import { missingFields } from '../auth/services/auth.service.js';
describe('Foundation validation', () => {
  it('requires no artificial skills for None', () => {
    expect(
      missingFields({
        current_role_title: 'Student',
        education: 'BSc',
        experience_level: 'beginner',
        learning_preference: 'mixed',
        preferred_daily_hours: 1,
        timezone: 'Asia/Dhaka',
        existing_skills_none: true,
        self_reported_skill_ids: [],
      }),
    ).toEqual([]);
  });
  it('rejects fractional non-half-hour settings', async () => {
    expect(
      await validate(
        plainToInstance(LearningPatch, { preferred_daily_hours: 1.2 }),
      ),
    ).not.toHaveLength(0);
  });
  it('rejects invalid timezone', async () => {
    expect(
      await validate(
        plainToInstance(LearningPatch, { timezone: 'not/a-zone' }),
      ),
    ).not.toHaveLength(0);
  });
  it('trims roles and rejects blank names', async () => {
    const p = plainToInstance(ProfilePatch, {
      current_role: '  Student ',
      existing_skills: [{ name: ' ' }],
    });
    expect(p.current_role).toBe('Student');
    expect(await validate(p)).not.toHaveLength(0);
  });
  it('rejects invalid skill UUID', async () => {
    expect(
      await validate(
        plainToInstance(AliasInput, { input: 'Node', skill_id: 'invalid' }),
      ),
    ).not.toHaveLength(0);
  });
});
