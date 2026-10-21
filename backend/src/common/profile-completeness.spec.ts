import { missingFields, profileComplete } from './profile-completeness.js';
const beginner = {
  current_role_title: 'Student',
  experience_level: 'beginner',
  existing_skills_none: true,
  self_reported_skill_ids: [],
  preferred_daily_hours: 1,
  learning_preference: 'mixed',
  timezone: 'Asia/Dhaka',
};
describe('C01/C05 profile completeness', () => {
  it('accepts None with no education and a confirmed goal', () =>
    expect(profileComplete(beginner, true)).toBe(true));
  it('requires a confirmed active goal even with education', () =>
    expect(missingFields({ ...beginner, education: 'BSc' }, false)).toEqual([
      'active_career_goal_ids',
    ]));
  it.each([
    'current_role_title',
    'experience_level',
    'preferred_daily_hours',
    'learning_preference',
    'timezone',
  ])('requires %s', (key) =>
    expect(profileComplete({ ...beginner, [key]: null }, true)).toBe(false),
  );
  it('requires explicit skills or None', () =>
    expect(
      missingFields({ ...beginner, existing_skills_none: false }, true),
    ).toEqual(['existing_skills']));
  it('accepts canonical self reported skills', () =>
    expect(
      profileComplete(
        {
          ...beginner,
          existing_skills_none: false,
          self_reported_skill_ids: ['skill'],
        },
        true,
      ),
    ).toBe(true));
});
