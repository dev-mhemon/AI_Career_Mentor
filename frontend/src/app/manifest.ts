import type { MetadataRoute } from 'next';

/**
 * PWA Web App Manifest (`C01 §4/§54/§58`, `C09 §8`).
 * Provides installable standalone PWA metadata and icons without offline-learning
 * Service Worker caching or Web Push notifications (excluded per `C01 §58`).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'AI Career Mentor',
    short_name: 'CareerMentor',
    description:
      'Bangla-first career roadmap, daily study plan, and AI practice mentor.',
    start_url: '/today',
    display: 'standalone',
    background_color: '#f8fafc',
    theme_color: '#0f766e',
    lang: 'bn',
    icons: [
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
    ],
  };
}
