import { describe, expect, it, vi } from 'vitest';
import { ProgressController } from './controllers/progress.controller.js';
import type { ProgressService } from './services/progress.service.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const SKILL_ID = '22222222-2222-4222-8222-222222222222';

describe('ProgressController (EP-G01, EP-G02, EP-G03 & R28 internal-only EP-G04)', () => {
  it('exposes ONLY GET routes for EP-G01, EP-G02, EP-G03 and has NO HTTP endpoint for EP-G04 (POST /progress/evidence)', async () => {
    const mockService = {
      getProgress: vi.fn().mockResolvedValue({
        progress: {
          roadmap_id: null,
          career_level: 'mid',
          roadmap_progress: {
            not_started: 0,
            learning: 0,
            practicing: 0,
            proficient: 0,
          },
          skills: [],
          weak_areas: [],
        },
        meta: { next_cursor: null, has_more: false },
      }),
      getSkillProgressDetail: vi.fn().mockResolvedValue({
        skill_id: SKILL_ID,
        name: 'SQL',
        levels: [],
      }),
      getProgressHistory: vi.fn().mockResolvedValue({
        items: [],
        meta: { next_cursor: null, has_more: false },
      }),
    } as unknown as ProgressService;

    const controller = new ProgressController(mockService);
    const proto = Object.getPrototypeOf(controller) as Record<string, unknown>;
    const methodNames = Object.getOwnPropertyNames(proto).filter(
      (name) => name !== 'constructor',
    );

    expect(methodNames.sort()).toEqual([
      'getProgress',
      'getProgressHistory',
      'getSkillProgressDetail',
    ]);
    expect('recordEvidence' in controller).toBe(false);
    expect('postEvidence' in controller).toBe(false);

    const progress = await controller.getProgress({
      user: { sub: USER_ID },
    });
    expect(mockService.getProgress).toHaveBeenCalledWith(USER_ID, undefined);
    expect(progress).toHaveProperty('data');
    expect(progress).toHaveProperty('meta');
  });
});
