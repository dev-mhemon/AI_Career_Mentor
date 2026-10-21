import { SetMetadata } from '@nestjs/common';
export type Feature =
  | 'roadmap_generator'
  | 'daily_plan'
  | 'quiz_practice'
  | 'ai_practice_review'
  | 'progress_tracking'
  | 'ai_mentor'
  | 'technology_update';
export interface AccessPolicy {
  public?: boolean;
  bootstrap?: boolean;
  allowSuspended?: boolean;
  admin?: boolean;
  feature?: Feature;
  existingRead?: boolean;
}
export const Policy = (policy: AccessPolicy) =>
  SetMetadata('access-policy', policy);
export const features: Feature[] = [
  'roadmap_generator',
  'daily_plan',
  'quiz_practice',
  'ai_practice_review',
  'progress_tracking',
  'ai_mentor',
  'technology_update',
];
