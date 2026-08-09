# Provisr Frontend Design

This design spec is the source of truth for the Provisr frontend. It adapts the supplied Framer-style dark canvas direction to a chat-first governed cloud infrastructure product.

## Product Model

Provisr is an operational app, not a marketing site.

- Chat is the primary experience for requesting infrastructure.
- Workspace Dashboard owns admin and insight surfaces.
- Requests, approvals, resources, and audit are operational views.
- The global icon rail contains only top-level navigation.

## Visual Direction

The app uses a near-black canvas with lifted charcoal panels and high-contrast white text. It should feel precise, calm, and cinematic without becoming decorative. Use one or two gradient atmosphere cards sparingly inside grids; never turn whole sections into gradients.

The interface language is:

- Near-black canvas.
- Charcoal surface cards.
- Pure white primary pill buttons.
- Muted gray secondary text.
- Blue only for focus, links, and selected signals.
- Gradient cards only as rare atmospheric accents.

## Tokens

| Token | Value | Use |
|---|---:|---|
| Canvas | `#050505` | Page and app background |
| Surface 1 | `#141414` | Sidebars, panels, cards |
| Surface 2 | `#222222` | Selected state, elevated panels, secondary controls |
| Ink | `#ffffff` | Headings and primary text |
| Ink muted | `#999999` | Secondary text and meta |
| Hairline | `rgba(255,255,255,.10)` | Borders |
| Hairline soft | `rgba(255,255,255,.07)` | Dividers |
| Accent blue | `#0099ff` | Focus rings, links, selection only |
| Primary CTA | `#ffffff` on `#050505` | Main action pills |
| Warning | `#f59e0b` at 12% bg / 35% border, `#fbbf24` text | Warning cards, non-blocking caveats (FE-C04) |
| Danger | `#ef4444` at 12% bg / 35% border, `#fca5a5` text | Destructive or blocked states |
| Success | `#22c94f` at 12% bg / 32% border, `#86efac` text | Approval, healthy status |

## Typography

Use Inter across the product with OpenType character variants enabled. Keep letter spacing at normal product UI spacing; the attached Framer marketing spec uses aggressive display tracking, but Provisr screens are operational and must remain readable.

- Page titles: compact, confident, white.
- Body: 14-15px with tight but readable line height.
- Captions and metadata: muted gray.
- Tables: tabular figures where possible.

## Layout

The desktop app keeps the established Provisr structure:

| Region | Width | Purpose |
|---|---:|---|
| Icon rail | 64px | Top-level app navigation |
| Chat sidebar or workspace sidebar | 260px | Contextual navigation/history |
| Main content | Fluid | Chat, dashboard, tables, drawers |

Use full-height app shells. The page body should not scroll as a whole when a contained region can own scrolling.

## Components

### Buttons

- Primary: white pill, black text, at least 40px high.
- Secondary: charcoal pill, white text, subtle hairline border.
- Ghost: text action with charcoal hover.
- Icon buttons: rounded square or circle, charcoal selected state.

### Cards

- Default cards use `Surface 1`, hairline border, 15-20px radius, and subtle light-edge depth.
- Featured cards use `Surface 2`.
- Gradient cards are allowed only as rare spotlight cards in dashboards or onboarding.

### Tables

Tables stay dark and quiet:

- Muted uppercase headers.
- Soft dividers.
- White primary values.
- Status badges with semantic text colors and dark-tinted surfaces.

### Navigation

The global rail contains only:

- Provisioning Chat
- Workspace Dashboard
- Requests
- Approvals
- Resources
- Audit Log
- Settings

Workspace Dashboard contains Policies, Cloud Accounts, Team, Billing & Usage, Workspace Settings, and Insights.

## Implementation Rules

- Prefer reusable components in `frontend/components/ui`.
- Keep the global dark theme in `frontend/app/globals.css`.
- Use the shared `provisr-app.tsx` primitives for app screens.
- Do not ask for long-lived cloud credentials anywhere in the UI.
- Do not show raw policy code by default.
- Keep the app chat-first and operational; avoid marketing landing-page composition.
