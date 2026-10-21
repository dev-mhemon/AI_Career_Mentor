import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AI Career Mentor",
  description:
    "Your personal AI-powered career mentor for personalized guidance and structured learning.",
};

/**
 * Layout for auth routes (/login, /register, /verify).
 * Provides a centered container for auth forms.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
