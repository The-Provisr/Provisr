import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import type { NextFetchEvent, NextRequest } from "next/server";
import { NextResponse } from "next/server";

const isProtectedRoute = createRouteMatcher([
  "/approvals(.*)",
  "/audit(.*)",
  "/chat(.*)",
  "/policy(.*)",
  "/requests(.*)",
  "/resources(.*)",
  "/settings(.*)",
  "/workspace(.*)",
]);

const withClerk = clerkMiddleware(async (auth, request) => {
  if (!isProtectedRoute(request)) {
    return;
  }

  const session = await auth();

  if (!session.userId) {
    await auth.protect();
    return;
  }

  if (!session.orgId) {
    return NextResponse.redirect(new URL("/onboarding", request.url));
  }
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
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
