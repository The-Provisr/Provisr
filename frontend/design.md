# Provisr Chat UI Design

This design spec is the source of truth for the Provisr chat front-end. It is based on the supplied Orbita GPT Tailwind reference and should guide future chat, sidebar, composer, and UI component work.

## Visual Direction

The chat UI is a quiet, work-focused infrastructure assistant surface. It uses a bright white canvas, pale gray separators, compact navigation, rounded controls, and restrained slate primary actions. The interface should feel precise and operational, not like a marketing page.

## Layout

The desktop layout has three fixed regions:

| Region | Width | Purpose |
|---|---:|---|
| Icon rail | 64px | Global product navigation and user controls |
| Chat sidebar | 260px | New chat, saved chats, and recent history |
| Main chat | Fluid | Conversation header, messages, tables, actions, composer |

The body is full viewport height, non-scrolling at the page level, and each scrollable region manages its own overflow.

## Tailwind Tokens

| Token | Tailwind |
|---|---|
| Page background | `bg-gray-50` |
| Surface | `bg-white` |
| Soft input surface | `bg-gray-50` |
| Primary action | `bg-slate-900 text-white hover:bg-slate-800` |
| Borders | `border-gray-100`, `border-gray-200` |
| Main text | `text-gray-900`, `text-gray-800` |
| Secondary text | `text-gray-600`, `text-gray-500` |
| Muted icon text | `text-gray-400` |
| Focus ring | `focus-visible:ring-2 focus-visible:ring-blue-100` |
| Main content max width | `max-w-[850px]` |
| Icon rail width | `w-16` |
| Sidebar width | `w-[260px]` |

## Components

### Buttons

Use pill buttons for primary actions and compact icon buttons for navigation/action tools.

- Primary pill: slate background, white text, `rounded-full`, `text-xs` or `text-sm`, bold.
- Secondary pill: white background, gray border, gray text, hover gray fill.
- Icon button: square hit target, `rounded-lg`, hover gray fill, active slate fill.

### Sidebar

The sidebar is a white fixed-width column with:

- Header row: title and search icon.
- Full-width `New Chat` primary pill.
- Scrollable history sections.
- Saved items with 24px avatars or icons.
- Recent items as one-line truncated text buttons.
- Bottom `Upgrade to Pro` primary pill.

### Chat Header

The header is 64px high with:

- Product title `Provisr GPT`.
- Small `Plus` badge.
- Right-aligned secondary and primary actions.

### Messages

User messages are right-aligned light-gray bubbles with `rounded-3xl`, compact padding, and max width of 80%.

Assistant messages are left-aligned, unframed content blocks. Tables use a subtle border, rounded corners, gray header, generous cell padding, and `divide-y divide-gray-100`.

### Composer

The composer sits at the bottom of the main chat view inside the 850px content width. It is a large rounded gray panel with:

- Prompt hint row with sparkle icon.
- Bottom action row for source, attach, voice, and send.
- Small centered disclaimer below.

## Responsive Behavior

The exact desktop reference is the primary target. On smaller screens, preserve the main chat first:

- Hide the icon rail below `md`.
- Hide the history sidebar below `lg`.
- Keep the header actions horizontally compact.
- Keep table content horizontally scrollable rather than squeezing columns.

## Implementation Rules

- Build with reusable React components under `frontend/components/ui`.
- Keep chat composition in `frontend/app/chat/page.tsx`.
- Prefer Tailwind utility classes over custom CSS.
- Custom CSS is allowed only for global page sizing and scrollbars.
- Do not allow arbitrary HTML from agent output into the UI component registry.
