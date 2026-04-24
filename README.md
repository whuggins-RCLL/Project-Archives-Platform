# The Digital Archivist - AI Librarian Suite

The Digital Archivist is a comprehensive Kanban and Portfolio management tool designed for library and archival teams. It provides a public-facing dashboard for stakeholders to track active and launched projects, and a secure internal dashboard for the team to manage the project lifecycle from intake to completion.

## Features

- **Public Stakeholder Dashboard**: A read-only view of active and launched projects, providing transparency without exposing internal drafts.
- **Internal Kanban Board**: Drag-and-drop interface for managing projects across different stages (Intake, Active, Launched).
- **Priority & Portfolio Views**: High-level overviews of project priorities, risk factors, and preservation scores.
- **Detailed Project Records**: In-depth view of individual projects, including metadata, tags, governance checkpoints, and an advanced collaboration thread with mentions, edit history, reactions, nested replies, and attachments.
- **AI Decision Support Workflows**: Generate next-best actions, risk narratives, and duplicate-project checks with confidence/explanation metadata and explicit human approval states.
- **Google Workspace Integrations**: Admins can choose a preferred Google Calendar for project dates and connect Drive folders so project files are visible in the platform.
- **Secure Authentication**: Google Workspace / Gmail authentication via Firebase to protect the internal dashboard.
- **Real-time Database**: Powered by Firebase Firestore for seamless, real-time updates across all clients.

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS, Lucide React (Icons)
- **Routing**: React Router v7
- **Backend & Auth**: Firebase (Firestore, Authentication, Storage)
- **Deployment**: Google Cloud Run / Firebase Hosting

## Setup Instructions

To run this project locally or deploy it yourself, you will need to set up a Firebase project.

### 1. Clone the Repository

```bash
git clone <repository-url>
cd Project-Archives
```

### 2. Set up Firebase

1. Go to the [Firebase Console](https://console.firebase.google.com/).
2. Click **Add project** and follow the prompts to create a new project.
3. Once the project is created, click the **Web** icon (`</>`) to add a web app to your project.
4. Register the app (you don't need to set up Firebase Hosting right now).
5. Copy the `firebaseConfig` object provided.

### 3. Configure Authentication

1. In the Firebase Console, go to **Authentication** (under Build).
2. Click **Get Started**.
3. Go to the **Sign-in method** tab.
4. Enable **Google** as a sign-in provider and save.

### 4. Configure Firestore Database

1. In the Firebase Console, go to **Firestore Database** (under Build).
2. Click **Create database**.
3. Choose a location and start in **Production mode**.
4. Go to the **Rules** tab and paste the contents of the `firestore.rules` file from this repository.
5. Click **Publish**.

### 5. Add Environment Variables

Create a file named `.env` in the root of the project and paste your Firebase configuration:

```env
VITE_FIREBASE_PROJECT_ID=YOUR_PROJECT_ID
VITE_FIREBASE_APP_ID=YOUR_APP_ID
VITE_FIREBASE_API_KEY=YOUR_API_KEY
VITE_FIREBASE_AUTH_DOMAIN=YOUR_AUTH_DOMAIN
VITE_FIREBASE_DATABASE_ID=(default)
VITE_FIREBASE_STORAGE_BUCKET=YOUR_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID=YOUR_MESSAGING_SENDER_ID

# Optional: Restrict team login to a specific domain (e.g., yourcompany.com)
VITE_ALLOWED_DOMAIN=yourcompany.com

# Optional: Comma-separated browser origins allowed to call server APIs
# (recommended for production)
CORS_ALLOWED_ORIGINS=https://your-app.vercel.app

# Optional: Express trust proxy setting ("false", "true", or proxy hop count like "1")
# Defaults to "1" in production and "false" in development.
TRUST_PROXY=1
```

*(Note: Keep `.env` out of version control so API keys are never committed. This project includes `.env.example` as the template for required values.)*

### 6. Install Dependencies & Run

```bash
# Install dependencies
npm install

# Start the development server
npm run dev
```

The app will be available at `http://localhost:3000`.

### Dependency Vulnerability Scan

Use the audit helper to scan dependencies:

```bash
npm run audit:deps
```

In restricted CI/sandbox environments, npm registry advisory endpoints can be blocked. When that happens, this helper reports a warning and exits successfully so the pipeline can flag it as an environment limitation instead of a confirmed vulnerability finding.



## Customizing Branding

You can easily customize the software to match your organization's identity colors and naming.

### 1. Update Naming and Text
Open `src/config.ts` and modify the `APP_CONFIG` object to change the application name, organization name, portal name, and hero text:

```typescript
export const APP_CONFIG = {
  appName: "Your App Name",
  orgName: "Your Organization",
  portalName: "Your Portal Name",
  // ... other text fields
};
```

### 2. Update Brand Colors
Open `src/index.css` and modify the CSS variables under the `BRANDING CONFIGURATION` section to match your brand's primary colors:

```css
:root {
  --brand-primary: #002045; /* Main primary color */
  --brand-dark: #1A365D; /* Darker shade for hero backgrounds and dark text */
}
```

## Restricting Team Login Domain

To ensure that only users from your organization can access the internal dashboard, you can restrict the Google Sign-In to a specific domain (e.g., `law.stanford.edu`).

1. Set the `VITE_ALLOWED_DOMAIN` environment variable in your `.env` file (and in Vercel).
2. The login screen will automatically prompt Google to only allow accounts from that domain.
3. If a user bypasses the UI and logs in with a different domain, the application will immediately sign them out and show an error message.

> Domain filtering is a convenience control at sign-in time. Authorization is enforced by Firebase custom claims and Firestore rules.

### Internal access claims (server + rules enforcement)

Client-side domain checks can be bypassed, so internal access is enforced again on the backend and in Firestore rules. A signed-in user is considered "internal" when **any** of these custom claims is present:

- `admin: true`
- `domain_authorized: true`
- `org_member: true`
- `groups: ["internal" | "staff" | "team" | "employee", ...]`

Admin API endpoints still require `admin: true`, but now also require the user to satisfy the internal-access claim check above.

## Admin Provisioning (Custom Claims)

This project now uses a Firebase **custom claim** (`admin: true`) instead of hardcoded email checks.

### Grant admin access (recommended: server-side script or Cloud Function)
Use the Firebase Admin SDK from a trusted environment:

```ts
import { getAuth } from 'firebase-admin/auth';

await getAuth().setCustomUserClaims('<UID>', { admin: true });
```

After setting claims, the user should sign out/sign in again (or refresh token) to receive the updated claim.

### Remove admin access

```ts
import { getAuth } from 'firebase-admin/auth';

await getAuth().setCustomUserClaims('<UID>', { admin: false });
```

## Deploying to Vercel

Because this project includes an Express server (`server.ts`) for secure AI/provider key handling and admin APIs, deploy it as a **Node.js app** (not static-only hosting).

1. Push your customized code to a GitHub repository.
2. Log in to Vercel and click **Add New... > Project**.
3. Import your GitHub repository.
4. Set build/runtime configuration:
   - **Build Command**: `npm run build`
   - **Install Command**: `npm install`
   - **Start Command**: `npm run start`
5. **Environment Variables**: Add Firebase and optional AI keys in the Vercel Environment Variables section:
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_APP_ID`
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_DATABASE_ID`
   - `VITE_FIREBASE_STORAGE_BUCKET`
   - `VITE_FIREBASE_MESSAGING_SENDER_ID`
   - `VITE_ALLOWED_DOMAIN` (optional)
   - Server-side AI/provider keys (`GEMINI_API_KEY`, `OPENAI_API_KEY`, `GROQ_API_KEY`, `GEMMA_API_KEY` / `GEMMA_BASE_URL`, etc.) if AI features are enabled
   - `GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON` (optional; required for Calendar/Drive sync unless you use ambient Google credentials)
   - `GOOGLE_WORKSPACE_IMPERSONATED_USER` (optional; Workspace admin-delegated user for Calendar/Drive domain-wide delegation)
   - Google Workspace integration variables (`FIREBASE_SERVICE_ACCOUNT_JSON`, optional `GOOGLE_WORKSPACE_IMPERSONATE_EMAIL`) if Calendar/Drive sync is enabled
6. Click **Deploy**.

**Important Post-Deployment Step:** Once Vercel provides your live production URL (for example `https://your-app.vercel.app`), add this domain to Firebase Authentication **Authorized domains** (Authentication → Settings → Authorized domains) so Google Sign-In works correctly.

## AI Features & Secure API Key Handling

The Digital Archivist includes optional AI features (Auto-Tagging, Summarization, Next-best Actions, Risk Narrative Drafting, and Duplicate Detection) that can be powered by Google Gemini, OpenAI, Anthropic Claude, Groq, or any OpenAI-compatible endpoint (Gemma slot, Groc slot).

### Enabling AI Features
1. Log in as an Admin.
2. Navigate to the **Settings** tab in the sidebar.
3. Toggle **Enable AI** (master switch), choose **Active AI provider**, then enable each **product** (Auto-tag, AI summarize, next-best actions, risk narrative, duplicate detection) independently.
4. Optionally require human approval before AI drafts are treated as approved.

After upgrading, **save settings once** so Firestore includes the new fields (`aiAutoTagEnabled`, `aiSummarizeEnabled`). Deploy updated **`firestore.rules`** if clients write `settings/global` directly.

## Google Calendar and Drive Integration

Admins can configure Google Workspace from **Settings -> Google Workspace Integrations**. These settings are stored in `settings/global`; no Google refresh tokens or user login settings are stored in the browser.

### Server prerequisites

The server uses the existing service-account credential path and Google REST APIs:

```env
# Required for server-side Calendar and Drive calls.
FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}

# Optional, but recommended for Workspace domains.
# Use a Workspace user that has access to the target calendar and Drive folders.
GOOGLE_WORKSPACE_IMPERSONATE_EMAIL=workspace-automation@example.com
```

If you set `GOOGLE_WORKSPACE_IMPERSONATE_EMAIL`, enable domain-wide delegation for the service account and authorize these scopes in the Google Admin console:

- `https://www.googleapis.com/auth/calendar.events`
- `https://www.googleapis.com/auth/drive`

If you do not impersonate a user, share the target calendar and Drive folders directly with the service account's `client_email`.

### Calendar setup

1. Create or choose the Google Calendar that should receive project dates.
2. Share it with the service account email, or with the impersonated Workspace user.
3. Copy the Calendar ID from Google Calendar settings.
4. In **Settings -> Google Workspace Integrations**, turn on **Post project dates to Google Calendar** and paste the Calendar ID.
5. Choose whether to post the project due date, milestone due dates, or both.

When an admin saves a project, the app posts all configured project dates as all-day events. Events use stable IDs derived from the project and milestone IDs, so saving a project updates existing events instead of creating duplicates. Calendar failures are logged and shown as a non-blocking warning; the project save still succeeds.

### Drive setup

1. Create or choose a shared Drive and folder structure.
2. Share the root folder and any subfolders with the service account email, or with the impersonated Workspace user.
3. Copy folder IDs from Drive URLs. For shared drives, optionally copy the shared drive ID.
4. In **Settings -> Google Workspace Integrations**, turn on **Connect Google Drive project files**, add the root folder ID, optional shared drive ID, and labeled subfolders.
5. Open a project record to view matching Drive files in the **Google Drive Files** panel.

The Drive panel searches the configured root and subfolders for file names containing the project code or title. If **Write a project manifest JSON file** is enabled, saving a project also writes `PROJECTCODE-project-manifest.json` into the root folder so external automations can discover project metadata.

### Multi-Model Chat Setup (for future clones)
Use this checklist if you are re-implementing model selection in a fresh clone:

1. Define a shared `AIModelOption` type in `src/types.ts` with `id`, `label`, `description`, and `provider`.
2. Add a shared `AI_MODEL_OPTIONS` list in `src/constants.tsx` (model ID + human label + short description).
3. In the AI interaction UI (record/chat workflows), add `selectedModel` state and a `<select>` bound to the options for the active provider.
4. Pass `selectedModel` into every AI send/generate call on the client.
5. Update `api.generateAI(...)` (or equivalent client API helper) to accept `model: string` and include it in the `/api/ai/generate` POST body (plus a `feature` key: `autoTag`, `summarize`, `nextBestAction`, or `riskNarrative` for server-side capability checks).
6. Update the server route (`/api/ai/generate`) to require `model` and forward it into the provider SDK request body (`model` field) so the chosen model is actually used.

### Secure API Key Configuration
**CRITICAL SECURITY NOTICE:** Never put your AI API keys (OpenAI, Anthropic, etc.) in frontend code or prefix them with `VITE_`. Doing so will expose your keys publicly.

This project no longer injects provider keys via Vite config. AI keys are server-side only.

To configure your AI providers, add the following to your `.env` file (and to your Vercel Environment Variables):

```env
# Google Gemini
GEMINI_API_KEY=your_gemini_api_key

# OpenAI (GPT-4o)
OPENAI_API_KEY=your_openai_api_key

# Anthropic (Claude 3.7 Sonnet)
ANTHROPIC_API_KEY=your_anthropic_api_key

# Gemma (any OpenAI-compatible chat endpoint — self-hosted, Together, etc.)
GEMMA_API_KEY=your_gemma_api_key
GEMMA_BASE_URL=https://example.com/v1

# Groq (first-class provider in app settings — use model IDs from https://console.groq.com/docs/models)
GROQ_API_KEY=your_groq_api_key
# GROQ_BASE_URL=https://api.groq.com/openai/v1  # optional; this is the default

# Groc (separate OpenAI-compatible slot)
GROC_API_KEY=
GROC_BASE_URL=

# Optional server-only alias for the Firebase Web API key used to verify ID tokens
# (if omitted, server falls back to VITE_FIREBASE_API_KEY at runtime)
FIREBASE_WEB_API_KEY=your_firebase_web_api_key

# Optional operations digest delivery targets (webhook endpoints)
# Slack incoming webhook for weekly summaries
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...

# Email automation webhook (SendGrid workflow, Zapier, etc.)
OPS_DIGEST_EMAIL_WEBHOOK_URL=https://your-email-automation-webhook
```

### Operations Layer (SLA + Dormancy + Overdue Stage + Weekly Digest)

Admins can trigger a weekly operations digest from the Portfolio view (**Run Ops Digest**) or by calling `POST /api/admin/operations/run`.

The digest includes:
- SLA alerts (past-due projects with incomplete progress)
- Dormant project detection (no updates in 30+ days)
- Overdue stage notifications (project age in stage exceeds target thresholds)
- Weekly digest summary delivery to Slack / Email webhooks when configured

### Deploying to Vercel with AI Features
Because the app now uses an Express backend to secure the API keys, you must deploy it as a Node.js server rather than a static site.
1. In Vercel, set the **Build Command** to `npm run build`.
2. Ensure Vercel is configured to run the `dist/server.cjs` file.
3. Add the AI API keys and (optionally) `FIREBASE_WEB_API_KEY` as server-side environment variables.
4. `/api/ai/generate` now requires a Firebase ID token for an authenticated user with `admin: true` custom claim.
5. Configure `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` for **distributed** rate limiting across serverless instances. If they are missing in production, the server still starts but logs a warning and falls back to per-instance in-memory limits (less reliable under load).
6. The API includes request-size limits and distributed rate limiting (including `/api/admin/settings` and `/api/admin/operations/run`), plus timeout guards on admin mutation/digest endpoints; tune these values in `server.ts` as needed.

## Data Visibility & Access Model

- `projects` are intentionally public-read to support the stakeholder dashboard.
- AI draft payloads (`aiDrafts`) are only valid when `settings/global.privacyMode` is `private-read`; in `public-read` mode they are blocked by Firestore rules to avoid exposing internal draft content.
- Project writes are admin-only and validated against a strict allow-list to avoid sensitive fields.
- `comments` are internal-only (`isAuthenticated()` read; create/update/delete restricted by ownership/admin), with optional mention/reaction/thread/attachment metadata validated by rules.
- `settings` are authenticated-read and admin-write.

If your organization needs private projects, change `allow read: if true` in `firestore.rules` to an authenticated/admin condition.

## Project Structure

- `/src/components`: Reusable UI components (Sidebar, Topbar, Modals).
- `/src/views`: Main page views (Kanban, Portfolio, Public Dashboard, Login).
- `/src/lib`: Utility functions and Firebase initialization (`firebase.ts`, `api.ts`).
- `/src/types.ts`: TypeScript interfaces for the data models.
- `firebase-blueprint.json`: A schema definition of the Firestore database structure.
- `firestore.rules`: The security rules for the Firestore database.

## License

SPDX-License-Identifier: Apache-2.0

## Role & Access Management (Owner/Admin/Collaborator/Viewer)

Authorization is enforced by Firebase custom claims using `role` as the source of truth:

- `owner`: super admin, can manage roles and all admin actions.
- `admin`: operational admin (settings, workflow, content), cannot change roles.
- `collaborator`: can create/edit project and collaboration content, cannot manage global settings or roles.
- `viewer`: read-only internal access.

Backward compatibility: users that still only have `admin: true` and no `role` claim are treated as `admin` during migration.

### Bootstrap the first owner

Use the in-app flow first, with script fallback only for break-glass scenarios:

1. **In-app self-service bootstrap (recommended)**
   - Set `OWNER_EMAILS=user1@example.com,user2@example.com`.
   - Set `FIREBASE_SERVICE_ACCOUNT_JSON` (service-account JSON string).
   - When there are zero owners, a signed-in matching user can open **Archive Settings** and click **Claim owner access**.
   - This writes the same custom claims (`role: owner`, `admin: true`) and audit trail as other role changes.

2. **Automatic bootstrap on server start**
   - On server start, matching users that already exist in Firebase Auth are granted owner claims.

3. **One-time script (fallback)**
   - Run: `node scripts/grant-owner-by-email.mjs user@example.com`
   - Requires `FIREBASE_SERVICE_ACCOUNT_JSON` and `FIREBASE_PROJECT_ID` (or `VITE_FIREBASE_PROJECT_ID`).

### Owner admin panel

Owners can open **Access Management** (`/app` -> sidebar -> Access Management) to:

- Search/filter users by role.
- Promote/demote between owner/admin/collaborator/viewer.
- Disable/enable users.
- Review role-audit history.

The backend blocks non-owner role mutations and prevents demoting/removing the last remaining owner.

### Testing role changes

1. Log in as owner.
2. Open Access Management and change a target user role.
3. Verify success toast and audit log entry.
4. As the target user, use **Refresh my access** (Access Management) or sign out/sign in to observe updated permissions.

### Token refresh behavior

Firebase custom claims are embedded in ID tokens. After role updates, users should force a claim refresh (via **Refresh my access**) or sign out/sign in before new permissions apply.

### Settings permissions

- `canViewSettings` is separate from `canManageSettings`.
- Owner/admin can view + save settings.
- Collaborator/viewer can open settings in read-only mode.
- All writes remain server-authorized by existing owner/admin checks.
