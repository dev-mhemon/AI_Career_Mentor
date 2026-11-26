import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import manifest from '@/app/manifest';
import { AIRecommendationCard } from '@/components/ai/ai-recommendation-card';
import { MilestoneCard } from '@/components/roadmap/milestone-card';
import { RoadmapPhaseCard } from '@/components/roadmap/roadmap-phase-card';
import { AppShell } from './app-shell';
import { BottomNavigation } from './bottom-navigation';
import { Header } from './header';
import { SkillBadge } from './skill-badge';
import {
  clearTelemetryEvents,
  getTelemetryEvents,
  trackEvent,
} from '@/lib/telemetry/telemetry';

let mockPathname = '/today';

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

vi.mock('@/lib/auth/actions', () => ({
  logoutAction: vi.fn(),
}));

function collectSourceFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next') {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectSourceFiles(fullPath));
    } else if (
      /\.(ts|tsx)$/.test(entry.name) &&
      !/\.test\.(ts|tsx)$/.test(entry.name)
    ) {
      results.push(fullPath);
    }
  }
  return results;
}

describe('M14-C Cross-Screen PWA, Responsive (360/768/1024+), WCAG 2.1 AA, R16 & Zero-PII Qualification', () => {
  beforeEach(() => {
    mockPathname = '/today';
    window.sessionStorage.clear();
    clearTelemetryEvents();
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: true,
    });
  });

  describe('1. PWA Boundary & Asset Verification (C01 §4/54/58, C09 §8)', () => {
    it('exports canonical standalone Bangla manifest with valid on-disk PNG/SVG icons and zero Service Worker or Push calls', () => {
      const result = manifest();

      expect(result.start_url).toBe('/today');
      expect(result.display).toBe('standalone');
      expect(result.lang).toBe('bn');
      expect(result.theme_color).toBe('#0f766e');

      const iconSrcs = (result.icons ?? []).map((i) => i.src);
      expect(iconSrcs).toEqual([
        '/icons/icon-192.png',
        '/icons/icon-512.png',
        '/icons/icon-maskable-512.png',
        '/icons/icon.svg',
      ]);

      const pngMagic = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
      for (const icon of result.icons ?? []) {
        const diskPath = path.resolve(
          process.cwd(),
          'public',
          icon.src.replace(/^\//, ''),
        );
        expect(existsSync(diskPath)).toBe(true);
        const bytes = readFileSync(diskPath);
        if (icon.src.endsWith('.png')) {
          expect(bytes.subarray(0, 8).equals(pngMagic)).toBe(true);
        } else {
          expect(bytes.toString('utf8')).toContain('<svg');
        }
      }

      // C01 §58: No offline-learning Service Worker registration or Web Push permission prompts.
      const srcRoot = path.resolve(process.cwd(), 'src');
      const sourceFiles = collectSourceFiles(srcRoot);
      expect(sourceFiles.length).toBeGreaterThan(20);
      for (const file of sourceFiles) {
        const code = readFileSync(file, 'utf8');
        expect(code).not.toContain('navigator.serviceWorker.register');
        expect(code).not.toContain('Notification.requestPermission');
      }
    });
  });

  describe('2. Responsive Breakpoint & Role Isolation (360px / 768px / 1024px+, C09 §2)', () => {
    it('renders desktop Sidebar + mobile BottomNavigation with 5 canonical tabs, >=44px targets, and pb-24 md:pb-8 clearance for active learners', () => {
      const { container } = render(
        <AppShell
          variant="learner"
          todayReadyDot={true}
          user={{ fullName: 'Mehedi Hasan' }}
        >
          <main id="main-content" tabIndex={-1}>
            <h1>Today Study Unit</h1>
          </main>
        </AppShell>,
      );

      // Desktop sidebar switches to persistent left rail at desktop breakpoint
      const sidebar = screen.getByRole('complementary', {
        name: 'Primary sidebar',
      });
      expect(sidebar.className).toContain('lg:translate-x-0');
      expect(sidebar.className).toContain('lg:visible');

      // Mobile BottomNavigation is strictly <768px (md:hidden) with 5 canonical tabs & >=44x44px targets
      const mobileNav = screen.getByRole('navigation', {
        name: 'Primary Mobile Navigation',
      });
      expect(mobileNav.className).toContain('md:hidden');
      const tabs = within(mobileNav).getAllByRole('link');
      expect(tabs).toHaveLength(5);
      for (const tab of tabs) {
        expect(tab.className).toContain('min-h-11');
        expect(tab.className).toContain('min-w-11');
      }
      expect(
        within(mobileNav).getByRole('link', { name: 'Today (ready)' }),
      ).toHaveAttribute('href', '/today');
      expect(
        within(mobileNav).getByRole('link', { name: 'Roadmap' }),
      ).toHaveAttribute('href', '/roadmaps');
      expect(
        within(mobileNav).getByRole('link', { name: 'Daily Plan' }),
      ).toHaveAttribute('href', '/daily-plan');
      expect(
        within(mobileNav).getByRole('link', { name: 'Progress' }),
      ).toHaveAttribute('href', '/progress');
      expect(
        within(mobileNav).getByRole('link', { name: 'Mentor' }),
      ).toHaveAttribute('href', '/mentor');

      // Content wrapper reserves bottom clearance for mobile thumb bar
      const main = screen.getByRole('main');
      expect(main.parentElement?.className).toContain('pb-24');
      expect(main.parentElement?.className).toContain('md:pb-8');
      expect(container.querySelector('#main-content')).toBe(main);
    });

    it('omits BottomNavigation completely for admin and suspended learner accounts', () => {
      const { rerender } = render(
        <AppShell variant="admin" user={{ fullName: 'Platform Admin' }}>
          <main id="main-content">Admin Console</main>
        </AppShell>,
      );

      expect(
        screen.queryByRole('navigation', {
          name: 'Primary Mobile Navigation',
        }),
      ).not.toBeInTheDocument();

      rerender(
        <AppShell
          variant="learner"
          accountStatus="suspended"
          user={{ fullName: 'Suspended Learner' }}
        >
          <main id="main-content">Settings</main>
        </AppShell>,
      );

      expect(
        screen.queryByRole('navigation', {
          name: 'Primary Mobile Navigation',
        }),
      ).not.toBeInTheDocument();
    });
  });

  describe('3. WCAG 2.1 AA Landmarks, Reduced Motion & Non-Color-Only Status (C01 §54, C09 §2/§8)', () => {
    it('provides header, #main-content main, and mobile nav landmarks plus global prefers-reduced-motion CSS', () => {
      render(
        <AppShell variant="learner" user={{ fullName: 'Mehedi Hasan' }}>
          <main id="main-content" tabIndex={-1}>
            <h1>Workspace</h1>
          </main>
        </AppShell>,
      );

      expect(screen.getByRole('banner')).toBeInTheDocument();
      expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
      expect(
        screen.getByRole('navigation', { name: 'Primary Mobile Navigation' }),
      ).toBeInTheDocument();

      const globalsCss = readFileSync(
        path.resolve(process.cwd(), 'src', 'app', 'globals.css'),
        'utf8',
      );
      expect(globalsCss).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
      expect(globalsCss).toContain('animation-duration: 0.01ms !important');
      expect(globalsCss).toContain('transition-duration: 0.01ms !important');
      expect(globalsCss).toContain('scroll-behavior: auto !important');
    });

    it('pairs icons with explicit text labels (never color-only) across SPEC components', () => {
      const { container } = render(
        <div>
          <SkillBadge label="PostgreSQL" status="in_progress" />
          <RoadmapPhaseCard
            phaseNo={1}
            title="Core Foundations"
            status="in_progress"
            estimatedHours={8}
          >
            <MilestoneCard
              title="SQL Joins Milestone"
              status="completed"
              completedTopics={4}
              totalTopics={4}
            />
          </RoadmapPhaseCard>
          <AIRecommendationCard
            title="Review Indexing Next"
            rationale="Your query practice indicates indexing is the next core skill."
          />
          <BottomNavigation pathname="/today" todayReadyDot={true} />
        </div>,
      );

      expect(screen.getByText('PostgreSQL')).toBeInTheDocument();
      expect(screen.getAllByText(/In Progress/).length).toBeGreaterThanOrEqual(2);
      expect(screen.getByText('Completed')).toBeInTheDocument();
      expect(screen.getByText('AI Recommendation')).toBeInTheDocument();
      expect(
        screen.getByTestId('bottom-nav-today-ready-dot'),
      ).toBeInTheDocument();
      expect(screen.getByText('Ready')).toBeInTheDocument();
      expect(container.querySelectorAll('svg').length).toBeGreaterThanOrEqual(8);
    });
  });

  describe('4. Offline -> Online Reconnection & R16 Input Preservation (C09 §4, R16)', () => {
    it('shows offline banner on offline, transitions to reconnection notice on online, and preserves in-progress child form input', () => {
      render(
        <AppShell variant="learner" user={{ fullName: 'Mehedi Hasan' }}>
          <main id="main-content">
            <label htmlFor="draft-answer">Draft Answer</label>
            <textarea id="draft-answer" defaultValue="" />
          </main>
        </AppShell>,
      );

      const mainEl = screen.getByRole('main');
      const textarea = screen.getByLabelText('Draft Answer') as HTMLTextAreaElement;
      fireEvent.change(textarea, {
        target: { value: 'SELECT id FROM public.users WHERE status = active;' },
      });
      expect(textarea.value).toBe(
        'SELECT id FROM public.users WHERE status = active;',
      );

      act(() => {
        Object.defineProperty(window.navigator, 'onLine', {
          configurable: true,
          value: false,
        });
        window.dispatchEvent(new Event('offline'));
      });

      expect(screen.getByRole('status')).toHaveTextContent(
        'You are offline. Reconnect to continue learning.',
      );
      expect(screen.getByRole('main')).toBe(mainEl);
      expect(textarea.value).toBe(
        'SELECT id FROM public.users WHERE status = active;',
      );

      act(() => {
        Object.defineProperty(window.navigator, 'onLine', {
          configurable: true,
          value: true,
        });
        window.dispatchEvent(new Event('online'));
      });

      expect(screen.getByRole('status')).toHaveTextContent(
        'Back online. Your connection has been restored.',
      );
      expect(screen.getByRole('main')).toBe(mainEl);
      expect(textarea.value).toBe(
        'SELECT id FROM public.users WHERE status = active;',
      );
    });
  });

  describe('5. Non-Guarantee & Zero-PII Telemetry Qualification (C01 §60, C09 §7, R11)', () => {
    it('emits zero "Job Ready" or guaranteed-employment claims across rendered learner components', () => {
      const { container } = render(
        <div>
          <Header variant="authenticated" user={{ fullName: 'Mehedi Hasan' }} />
          <AIRecommendationCard
            title="Strengthen Async Architecture"
            rationale="Focus on PostgreSQL SKIP LOCKED queues and transactional boundaries."
          />
          <RoadmapPhaseCard
            phaseNo={1}
            title="Distributed Patterns"
            status="locked"
            estimatedHours={10}
          >
            <MilestoneCard
              title="Transactional Queues"
              status="in_progress"
              completedTopics={2}
              totalTopics={5}
            />
          </RoadmapPhaseCard>
          <BottomNavigation pathname="/roadmaps" />
        </div>,
      );

      const text = container.textContent ?? '';
      expect(text).not.toMatch(/job\s*ready/i);
      expect(text).not.toMatch(/you will get a job/i);
      expect(text).not.toMatch(/guaranteed\s+(job|employment|hiring)/i);
    });

    it('strips 100% of non-allowlisted keys, disguised phone tokens, PII/content keys, and raw PII patterns while preserving valid categorical values', () => {
      trackEvent({
        event_name: 'career_goal_submitted',
        feature_key: 'onboarding',
        screen_name: 'onboarding_goal',
        request_id: '22222222-2222-4222-8222-222222222222',
        metadata: {
          detail: 'My private mentor message',
          contact_number: 8801712345678,
          source: '01712-345678',
          screen_name: '01712-345678',
          reason_code: 'CONTACT_01712_345678',
          request_id: 'req_01712_345678',
          goal_text: 'I want to become a Backend Architect in Dhaka',
          answer_text: 'My free response quiz answer text',
          content: 'Private mentor chat turn',
          email: 'user@example.com',
          phone: '+8801712345678',
          password: 'UltraSecretPassword!1',
          raw_email_val: 'user@example.com',
          raw_phone_val: '+8801712345678',
          raw_jwt_val: 'Bearer eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ1MSJ9.sig',
          channel: 'email',
          step: 4,
        },
      });

      trackEvent({
        event_name: 'roadmap_activated',
        feature_key: 'roadmap_generator',
        screen_name: 'roadmap_draft',
        metadata: {
          channel: 'email',
          source: 'roadmap_draft',
          screen_name: 'career_profile',
        },
      });

      const events = getTelemetryEvents();
      expect(events).toHaveLength(2);
      expect(events[0]?.metadata).toEqual({
        channel: 'email',
        step: 4,
      });
      expect(events[1]?.metadata).toEqual({
        channel: 'email',
        source: 'roadmap_draft',
        screen_name: 'career_profile',
      });

      const serialized = JSON.stringify(events);
      expect(serialized).not.toContain('private mentor');
      expect(serialized).not.toContain('Backend Architect');
      expect(serialized).not.toContain('free response');
      expect(serialized).not.toContain('Private mentor');
      expect(serialized).not.toContain('user@example.com');
      expect(serialized).not.toContain('8801712345678');
      expect(serialized).not.toContain('01712-345678');
      expect(serialized).not.toContain('01712_345678');
      expect(serialized).not.toContain('UltraSecretPassword');
      expect(serialized).not.toContain('eyJhbGci');
    });
  });
});
