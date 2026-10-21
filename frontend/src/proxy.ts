import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Next.js 16 Proxy — lightweight edge interceptor.
 *
 * Responsibilities (Plan v1.3 §4):
 *  - Refresh/maintain Supabase session (extend cookies)
 *  - Redirect unauthenticated users away from protected routes
 *
 * This proxy DOES NOT:
 *  - Call NestJS /api/auth/me
 *  - Inspect specific application status (e.g. SUSPENDED vs ACTIVE)
 *  - Make application authorization decisions
 *  - Replace NestJS guards
 */

const PROTECTED_ROUTES = ["/dashboard"];

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Forward set-cookie instructions into the request and response.
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Refresh the session — this keeps the cookie alive.
  // getClaims() performs fast local JWT validation without a network call.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  // Unauthenticated users trying to access protected routes → /login
  if (!user && PROTECTED_ROUTES.some((r) => pathname.startsWith(r))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Note: We intentionally do NOT redirect authenticated users away
  // from /login or /register here. That redirect is handled
  // by the Server Components on those pages.

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico, robots.txt, sitemap.xml (metadata files)
     * - public assets (SVGs, images)
     */
    "/((?!_next/static|_next/image|favicon.ico|robots\\.txt|sitemap\\.xml|.*\\.svg$|.*\\.png$).*)",
  ],
};
