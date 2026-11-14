import type { Metadata } from 'next';
import { inter, geist, hindSiliguri, jetbrainsMono } from '@/fonts';
import { SkipLink } from '@/components/ui/skip-link';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI Career Mentor',
  description:
    'Your personal AI-powered career mentor for personalized guidance and structured learning.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${geist.variable} ${hindSiliguri.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body suppressHydrationWarning className="min-h-full flex flex-col">
        <SkipLink />
        <div className="flex flex-1 flex-col">{children}</div>
      </body>
    </html>
  );
}
