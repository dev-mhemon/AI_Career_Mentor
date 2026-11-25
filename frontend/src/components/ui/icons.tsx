import type { SVGProps } from 'react';
import { cn } from './cn';

type P = SVGProps<SVGSVGElement>;
const base = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
} as const;

const iconProps = (p: P, extra?: string) => ({
  ...base,
  ...p,
  className: cn('block shrink-0', extra, p.className),
});

export const SpinnerIcon = (p: P) => (
  <svg {...iconProps(p, 'animate-spin motion-reduce:animate-none')}>
    <path d="M21 12a9 9 0 1 1-6.2-8.55" />
  </svg>
);
export const AlertCircleIcon = (p: P) => (
  <svg {...iconProps(p)}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 8v4M12 16h.01" />
  </svg>
);
export const InfoIcon = (p: P) => (
  <svg {...iconProps(p)}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 16v-4M12 8h.01" />
  </svg>
);
export const CheckCircleIcon = (p: P) => (
  <svg {...iconProps(p)}>
    <circle cx="12" cy="12" r="10" />
    <path d="m8 12 3 3 5-6" />
  </svg>
);
export const WarningIcon = (p: P) => (
  <svg {...iconProps(p)}>
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01" />
  </svg>
);
export const EyeIcon = (p: P) => (
  <svg {...iconProps(p)}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
export const EyeOffIcon = (p: P) => (
  <svg {...iconProps(p)}>
    <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c6.5 0 10 7 10 7a16.8 16.8 0 0 1-1.95 2.95" />
    <path d="M6.61 6.61A16.8 16.8 0 0 0 2 12s3.5 7 10 7a10.4 10.4 0 0 0 5.39-1.61" />
    <circle cx="12" cy="12" r="3" />
    <path d="M2 2l20 20" />
  </svg>
);
export const ClockIcon = (p: P) => (
  <svg {...iconProps(p)}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 6v6l4 2" />
  </svg>
);
export const CloseIcon = (p: P) => (
  <svg {...iconProps(p)}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);
export const CheckIcon = (p: P) => (
  <svg {...iconProps(p)}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);
export const MinusIcon = (p: P) => (
  <svg {...iconProps(p)}>
    <path d="M5 12h14" />
  </svg>
);
export const LayoutDashboardIcon = (p: P) => (
  <svg {...iconProps(p)}>
    <rect x="3" y="3" width="7" height="9" rx="1.5" />
    <rect x="14" y="3" width="7" height="5" rx="1.5" />
    <rect x="14" y="12" width="7" height="9" rx="1.5" />
    <rect x="3" y="16" width="7" height="5" rx="1.5" />
  </svg>
);
export const UserCheckIcon = (p: P) => (
  <svg {...iconProps(p)}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="m16 11 2 2 4-4" />
  </svg>
);
export const HomeIcon = (p: P) => (
  <svg {...iconProps(p)}>
    <path d="m3 10 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <path d="M9 22V12h6v10" />
  </svg>
);
export const SettingsIcon = (p: P) => (
  <svg {...iconProps(p)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.85 1 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);
export const SidebarToggleIcon = (p: P) => (
  <svg {...iconProps(p)}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M9 3v18" />
  </svg>
);
export const MenuIcon = (p: P) => (
  <svg {...iconProps(p)}>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);
export const SearchIcon = (p: P) => (
  <svg {...iconProps(p)}>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);
export const BellIcon = (p: P) => (
  <svg {...iconProps(p)}>
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </svg>
);
export const ChevronDownIcon = (p: P) => (
  <svg {...iconProps(p)}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);
export const UserIcon = (p: P) => (
  <svg {...iconProps(p)}>
    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);
export const LogOutIcon = (p: P) => (
  <svg {...iconProps(p)}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);
export const LockIcon = (p: P) => (
  <svg {...iconProps(p)}>
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);
export const ChevronRightIcon = (p: P) => (
  <svg {...iconProps(p)}>
    <path d="m9 18 6-6-6-6" />
  </svg>
);
export const ChevronLeftIcon = (p: P) => (
  <svg {...iconProps(p)}>
    <path d="m15 18-6-6 6-6" />
  </svg>
);
export const CompassIcon = (p: P) => (
  <svg {...iconProps(p)}>
    <circle cx="12" cy="12" r="10" />
    <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
  </svg>
);
export const BookOpenIcon = (p: P) => (
  <svg {...iconProps(p)}>
    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
    <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
  </svg>
);
export const SparklesIcon = (p: P) => (
  <svg {...iconProps(p)}>
    <path d="m12 3-1.91 5.81a2 2 0 0 1-1.28 1.28L3 12l5.81 1.91a2 2 0 0 1 1.28 1.28L12 21l1.91-5.81a2 2 0 0 1 1.28-1.28L21 12l-5.81-1.91a2 2 0 0 1-1.28-1.28Z" />
  </svg>
);
export const GlobeIcon = (p: P) => (
  <svg {...iconProps(p)}>
    <circle cx="12" cy="12" r="10" />
    <path d="M2 12h20" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);
export const CalendarDaysIcon = (p: P) => (
  <svg {...iconProps(p)}>
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <path d="M16 2v4M8 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01" />
  </svg>
);
export const ExternalLinkIcon = (p: P) => (
  <svg {...iconProps(p)}>
    <path d="M15 3h6v6" />
    <path d="M10 14 21 3" />
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
  </svg>
);
export const RefreshCwIcon = (p: P) => (
  <svg {...iconProps(p)}>
    <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
    <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
    <path d="M16 16h5v5" />
  </svg>
);
export const TargetIcon = (p: P) => (
  <svg {...iconProps(p)}>
    <circle cx="12" cy="12" r="10" />
    <circle cx="12" cy="12" r="6" />
    <circle cx="12" cy="12" r="2" />
  </svg>
);
export const MessageSquareIcon = (p: P) => (
  <svg {...iconProps(p)}>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);
export const MessageCircleIcon = (p: P) => (
  <svg {...iconProps(p)} strokeWidth={p.strokeWidth ?? 1.75}>
    <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
  </svg>
);
export const SendIcon = (p: P) => (
  <svg {...iconProps(p)}>
    <path d="m22 2-7 20-4-9-9-4Z" />
    <path d="M22 2 11 13" />
  </svg>
);
export const PlusIcon = (p: P) => (
  <svg {...iconProps(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
export const BotIcon = (p: P) => (
  <svg {...iconProps(p)} strokeWidth={p.strokeWidth ?? 1.75}>
    <path d="M12 8V4H8" />
    <rect width="16" height="12" x="4" y="8" rx="2" />
    <path d="M2 14h2" />
    <path d="M20 14h2" />
    <path d="M15 13v2" />
    <path d="M9 13v2" />
  </svg>
);
export const RadioIcon = (p: P) => (
  <svg {...iconProps(p)} strokeWidth={p.strokeWidth ?? 1.75}>
    <path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9" />
    <path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5" />
    <circle cx="12" cy="12" r="2" />
    <path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5" />
    <path d="M19.1 4.9C23 8.8 23 15.1 19.1 19" />
  </svg>
);
export const ShieldIcon = (p: P) => (
  <svg {...iconProps(p)}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);
export const UsersIcon = (p: P) => (
  <svg {...iconProps(p)}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);
export const SlidersIcon = (p: P) => (
  <svg {...iconProps(p)}>
    <line x1="4" y1="21" x2="4" y2="14" />
    <line x1="4" y1="10" x2="4" y2="3" />
    <line x1="12" y1="21" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12" y2="3" />
    <line x1="20" y1="21" x2="20" y2="16" />
    <line x1="20" y1="12" x2="20" y2="3" />
    <line x1="2" y1="14" x2="6" y2="14" />
    <line x1="10" y1="8" x2="14" y2="8" />
    <line x1="18" y1="16" x2="22" y2="16" />
  </svg>
);
export const BarChartIcon = (p: P) => (
  <svg {...iconProps(p)}>
    <line x1="12" y1="20" x2="12" y2="10" />
    <line x1="18" y1="20" x2="18" y2="4" />
    <line x1="6" y1="20" x2="6" y2="16" />
  </svg>
);
export const ArrowLeftIcon = (p: P) => (
  <svg {...iconProps(p)}>
    <path d="m12 19-7-7 7-7" />
    <path d="M19 12H5" />
  </svg>
);
export const FileTextIcon = (p: P) => (
  <svg {...iconProps(p)}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
    <line x1="10" y1="9" x2="8" y2="9" />
  </svg>
);
