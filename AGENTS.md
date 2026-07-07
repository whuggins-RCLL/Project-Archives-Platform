# AGENTS.md

## Cursor Cloud specific instructions

This repo is **The Digital Archivist / Project Archives**: a React 19 + Vite + Tailwind SPA served by an Express backend (`server.ts`), backed by Firebase (Auth + Firestore + Storage). See `README.md` for the full product/setup docs and env var reference (`.env.example` is the template).

### Services / how to run
- There is a **single service**: `npm run dev` runs `tsx server.ts`, which starts Express and mounts Vite in middleware mode. It serves both the API (`/api/*`) and the SPA on `http://localhost:3000`. There is no separate frontend dev server.
- Standard commands (already defined in `package.json` scripts): `npm run lint` (`tsc --noEmit`), `npm run build` (vite build + esbuild server bundle), `npm run ci:guard` (persistent-state guard, also runs in CI).
- **Automated tests use Node's built-in runner and there is no `test` npm script.** Test files are `src/lib/*.test.ts` (they `import 'node:test'`). Run them with: `npx tsx --test src/lib/*.test.ts`.

### Non-obvious caveats
- **Firebase credentials gate the whole app.** Without the `VITE_FIREBASE_*` vars set (in a local, gitignored `.env`), the SPA renders a "Setup required" screen instead of the app. With any values set, the public dashboard (`/`) and login page (`/login`) render, but real Auth/Firestore need a genuine Firebase project. There is **no Firebase emulator wiring in the client code** (`src/lib/firebase.ts` never calls `connect*Emulator`), so true end-to-end flows (Google sign-in, create/edit projects, Kanban, comments) require real Firebase project credentials plus a Google login account — these must come from user-provided secrets.
- The Express server starts fine **without** any Firebase env (it warns about `FIREBASE_SERVICE_ACCOUNT_JSON` and falls back to ADC / in-memory rate limiting); admin/Firestore-backed API routes just won't work until credentials are provided. `GET /api/health` returns `{"status":"ok"}` with no auth.
- Vite dev server **cold start** can briefly show a blank white page on the very first request while it compiles; reload once if the page looks empty.
- `npm run audit:deps` may fail to reach npm advisory endpoints in sandboxed/network-restricted environments; the helper treats that as a warning (non-fatal), not a vulnerability finding.
- Node: CI uses Node 20; the app also runs fine on Node 22.
