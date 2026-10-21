/** C01 §7/14 and C05 §14.3: education is optional; a confirmed active goal is required. */
export function missingFields(
  p: Record<string, any>,
  hasConfirmedGoal: boolean,
): string[] {
  return [
    'current_role_title',
    'experience_level',
    'learning_preference',
    'preferred_daily_hours',
    'timezone',
  ]
    .filter((key) => !p[key])
    .map((key) => (key === 'current_role_title' ? 'current_role' : key))
    .concat(
      p.existing_skills_none || p.self_reported_skill_ids?.length
        ? []
        : ['existing_skills'],
    )
    .concat(hasConfirmedGoal ? [] : ['active_career_goal_ids']);
}
export function profileComplete(
  p: Record<string, any>,
  hasConfirmedGoal: boolean,
): boolean {
  return missingFields(p, hasConfirmedGoal).length === 0;
}
