# Clerk setup

The onboarding flow uses Clerk for authentication and Clerk Organizations for
workspace creation.

1. Create or select a Clerk application.
2. Enable Organizations in the Clerk Dashboard.
3. Add the following environment variables to your local or hosted runtime:

```text
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/onboarding
NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/onboarding
```

When the two Clerk keys are absent, `/onboarding` remains available in preview
mode. Protected product routes are enforced only when both keys are configured.
