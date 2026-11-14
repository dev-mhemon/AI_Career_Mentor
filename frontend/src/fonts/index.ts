import localFont from 'next/font/local';

export const inter = localFont({
  src: './inter/inter-latin.woff2',
  weight: '400 700',
  style: 'normal',
  variable: '--font-inter',
  display: 'swap',
  fallback: ['system-ui', 'sans-serif'],
});

export const geist = localFont({
  src: './geist/geist-latin.woff2',
  weight: '100 900',
  style: 'normal',
  variable: '--font-geist',
  display: 'swap',
  fallback: ['system-ui', 'sans-serif'],
});

export const hindSiliguri = localFont({
  src: [
    { path: './hind-siliguri/hind-siliguri-400.woff2', weight: '400', style: 'normal' },
    { path: './hind-siliguri/hind-siliguri-500.woff2', weight: '500', style: 'normal' },
    { path: './hind-siliguri/hind-siliguri-600.woff2', weight: '600', style: 'normal' },
    { path: './hind-siliguri/hind-siliguri-700.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-hind-siliguri',
  display: 'swap',
  fallback: ['Noto Sans Bengali', 'system-ui', 'sans-serif'],
});

export const jetbrainsMono = localFont({
  src: './jetbrains-mono/jetbrains-mono-latin.woff2',
  weight: '400 700',
  style: 'normal',
  variable: '--font-jetbrains-mono',
  display: 'swap',
  fallback: ['Consolas', 'monospace'],
});
