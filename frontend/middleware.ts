import {
  clerkMiddleware,
  createRouteMatcher,
} from "@clerk/nextjs/server";
import type { NextFetchEvent, NextRequest } from "next/server";
import { NextResponse } from "next/server";

const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in/:path*",
  "/sign-up/:path*",
  "/api/webhooks/:path*",
]);

const isOnboardingRoute = createRouteMatcher(["/onboarding/:path*", "/post-auth"]);

const withClerk = clerkMiddleware(async (auth, request) => {
  const isApi = request.nextUrl.pathname.startsWith("/api");

  // Middleware performs no auth enforcement on /api/* by design. Every route
  // handler carries its own check (auth.protect() or verifyToken).
  if (isApi) {
    return NextResponse.next();
  }

  const { userId, sessionClaims, redirectToSignIn } = await auth();

  // Signed out on a protected route → Clerk sign-in, preserving return URL.
  if (!userId && !isPublicRoute(request)) {
    return redirectToSignIn({ returnBackUrl: request.url });
  }

  if (!userId) {
    return NextResponse.next();
  }

  // Signed in but no workspace → onboarding.
  const hasWorkspace = Boolean(sessionClaims?.metadata?.workspaceId);
  if (userId && !hasWorkspace && !isOnboardingRoute(request) && !isPublicRoute(request)) {
    return NextResponse.redirect(new URL("/onboarding", request.url));
  }

  // Onboarded user landing on /onboarding → bounce to dashboard.
  if (hasWorkspace && request.nextUrl.pathname.startsWith("/onboarding")) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
});

export default function middleware(request: NextRequest, event: NextFetchEvent) {
  if (
    !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
    !process.env.CLERK_SECRET_KEY
  ) {
    return NextResponse.next();
  }

  return withClerk(request, event);
}

export const config = {
  matcher: [
    // Skip Next.js internals and static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
