# figma-make-app

React + Vite + Tailwind CSS project running inside Figma Make.

## Development Server

A Vite development server is **already running** on `$PORT` (default 8443). You don't need to start it manually.

- Preview URL: The user can access the running app through the preview panel
- Hot reload: Changes to source files are reflected immediately

## Project Structure

This is the canonical project structure. Start with task-relevant files below. Only follow imports or inspect other files when required, when a documented path is missing, or when the repository contradicts this guide.

- `src/main.tsx` - React entrypoint; imports `src/index.css` and mounts `src/App.tsx` into the `#root` element
- `src/App.tsx` - Role router only: picks the portal for the signed-in user
- `src/index.css` - Global CSS entrypoint and Tailwind CSS v4 import

### mCare source layout

No other files belong at the top of `src/`. Every source file lives in one of these folders:

- `src/shared/` - Everything used by more than one role
  - `index.ts` - The shared UI kit. Import UI from `@/shared` (e.g. `import { PageTitle, Pill } from '@/shared'`)
  - `state/` - `AppContext` (app state and actions) and `auth`
  - `lib/` - `types` and `vitals` (domain types and pure helpers)
  - `documents/` - Medical documents: store, seed data, DocKit, viewer, and upload/share sheets
  - `email/` - `emailTemplate` (the one branded layout and the catalogue of every email mCare sends) and `Mailbox` (in-app view of sent emails). Never build email HTML anywhere else; send through `notify()` or the builders in `emailTemplate`. The logo image is `public/brand/mcare-logo.png`
  - `api/` - `supabase` (the backend connection; demo mode when no keys are set)
  - `ui/` - Primitives, BottomSheet/Field/Toast, alerts, vitals widgets, chat, notifications, and the home-screen kit (`home.tsx`)
  - `layout/` - PhoneShell, StatusBar, `PortalShell` (screen frame + NavBar for every portal), logo, loading
  - `profile/` - ProfileCard and account settings sheets (the same for every role)
  - `auth/` - Login, register, verification, doctor-status and suspended screens
- `src/patient/`, `src/doctor/`, `src/admin/` - One folder per portal: `<Role>App.tsx` plus its screens
- `src/assistant/` - The mCare Assistant portal (admin screens gated by permissions), plus `permissions.ts` (`can()`, `canOpenTab()`)

Import rules: use `@/…` for anything in another folder and `./…` within the same folder. Never import with `../`.

### Design rules (the patient portal is the reference)

- Every portal renders inside `PortalShell`. Profile is opened from the header avatar, not from a nav tab.
- Responsive: the app frame (`PhoneShell`) fills the window and is a CSS container. Build mobile-first, then use Tailwind **container** variants — `@2xl:` for tablet (672px+), `@5xl:` for web (1024px+). Never use viewport variants (`md:`, `lg:`); they break the Web / Tablet / Mobile preview switcher. `PortalShell` turns the bottom tab bar into a side rail (tablet) and a sidebar (web) and keeps content to a readable width; Sheets become centred dialogs on tablet and web automatically.
- Stacked cards flow into two columns on tablet and web through the `card-flow` class (`Page` applies it; pass `flow={false}` for a screen with its own grid). Plain-stack roots add `card-flow` themselves; add `span-all` to a child that must stay full width. `PortalShell` takes `narrow` for single-column screens such as Profile.
- Font sizes can't be switched with a container variant on the same element as `text-[9px]`/`text-xs`… (the font-scale rules in `index.css` win). Render two elements and show one per size.
- Device scale: size everything in rem through Tailwind's scales (`w-6`, `gap-3`, `text-sm`), not px (`w-[18px]`, inline `fontSize: 40`). The root font size follows the device's text size and is reduced automatically on phones narrower than 390px (`src/shared/layout/deviceScale.ts`), so rem-sized UI shrinks together; px-sized UI does not. A new `text-[Npx]` size needs a matching line in the font-scale block of `index.css`.
- Charts measure their own width (`useElementWidth` from `@/shared`); don't hard-code an SVG width.
- Every home screen uses `PortalHeader`, then a `HeroCard`, then a `QuickGrid`, then `NoticeCard`s, all from `@/shared`.
- Other screens are wrapped in `Page` (title row, card spacing, loading and error states), or start with `BackHeader` for detail views. Use `EmptyState` for empty lists. `PageTitle` is the older form; prefer `Page`.
- Patient screens read and change the patient's record only through `usePatient()` (`src/patient/usePatient.ts`). Never call `updateUser` or read the `users` list from a patient screen; add a named action to the hook instead. Each action maps to one future API endpoint.
- Brand teal (`teal-700`) is the only colour for action buttons. Blue, purple and amber mark status or role only.
- Fonts: use the `font-display` class for headings and `font-mono` for numbers. Never use inline `fontFamily`.
- Put UI you would reuse in `src/shared/ui/` instead of redefining it inside a screen.
- `index.html` - Vite HTML shell containing the `#root` element and loading `src/main.tsx`
- `package.json` - Project dependencies and the Vite build, development, preview, and formatting scripts
- `vite.config.ts` - Vite configuration with React, Tailwind CSS v4, and Figma Make plugins plus the `@` alias for `src`
- `.mise.toml` - Toolchain versions for Node.js and pnpm

## Backend

The backend is Supabase (Postgres), not Laravel. Schema and access rules live in `supabase/migrations/`. After changing a migration run `node supabase/tests/rules.test.mjs`. Add new numbered migrations instead of editing ones already applied.

## Dependencies

- Runtime: React 19, React DOM 19 and `@supabase/supabase-js`
- Styling: Tailwind CSS v4 with the `@tailwindcss/vite` plugin
- Build tooling: Vite 8, TypeScript 5.7, and `@vitejs/plugin-react`
- Formatting: oxfmt

## Styling

This project uses **Tailwind CSS v4** through the `@tailwindcss/vite` plugin configured in `vite.config.ts`. `src/index.css` imports Tailwind with `@import 'tailwindcss';`. Use Tailwind utility classes directly in JSX and put global CSS or Tailwind v4 theme customization in `src/index.css`. This scaffold does not need a Tailwind config file or PostCSS config.

`src/main.tsx` imports `src/index.css`, so global font wiring belongs in `src/index.css`. Keep CSS `@import` statements first, then add any `@font-face` rules and font-family defaults there.
