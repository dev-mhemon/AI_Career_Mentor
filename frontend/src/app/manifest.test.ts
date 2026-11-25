import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import manifest from './manifest';

describe('PWA Web App Manifest (C01 §4/54/58, C09 §8)', () => {
  it('returns canonical standalone Bangla-first manifest metadata and verified PNG/SVG icons', () => {
    const result = manifest();

    expect(result.name).toBe('AI Career Mentor');
    expect(result.short_name).toBe('CareerMentor');
    expect(result.description).toBe(
      'Bangla-first career roadmap, daily study plan, and AI practice mentor.',
    );
    expect(result.start_url).toBe('/today');
    expect(result.display).toBe('standalone');
    expect(result.background_color).toBe('#f8fafc');
    expect(result.theme_color).toBe('#0f766e');
    expect(result.lang).toBe('bn');

    expect(result.icons).toEqual([
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
      },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
      },
    ]);

    const pngHeader = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    for (const icon of result.icons ?? []) {
      const filePath = path.resolve(
        process.cwd(),
        'public',
        icon.src.replace(/^\//, ''),
      );
      expect(existsSync(filePath)).toBe(true);
      const bytes = readFileSync(filePath);
      if (icon.type === 'image/png') {
        expect(bytes.subarray(0, 8).equals(pngHeader)).toBe(true);
      } else {
        expect(bytes.toString('utf8')).toContain('<svg');
      }
    }
  });
});
