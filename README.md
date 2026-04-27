# The Digital Archivist - AI Librarian Suite

The Digital Archivist is a comprehensive Kanban and Portfolio management tool designed for library and archival teams. It provides a public-facing dashboard for stakeholders to track active and launched projects, and a secure internal dashboard for the team to manage the project lifecycle from intake to completion.

## Features

- **Public Stakeholder Dashboard**: A read-only view of active and launched projects, providing transparency without exposing internal drafts.
- **Internal Kanban Board**: Drag-and-drop interface for managing projects across different stages (Intake, Active, Launched).
- **Priority & Portfolio Views**: High-level overviews of project priorities, risk factors, and preservation scores.
- **Detailed Project Records**: In-depth view of individual projects, including metadata, tags, governance checkpoints, and an advanced collaboration thread with mentions, edit history, reactions, nested replies, and attachments.
- **AI Decision Support Workflows**: Generate next-best actions, risk narratives, and duplicate-project checks with confidence/explanation metadata and explicit human approval states.
- **Secure Authentication**: Google Workspace / Gmail authentication via Firebase to protect the internal dashboard.
- **Real-time Database**: Powered by Firebase Firestore for seamless, real-time updates across all clients.

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS, Lucide React (Icons)
- **Routing**: React Router v7
- **Backend & Auth**: Firebase (Firestore, Authentication, Storage)
- **Deployment**: Vercel (primary) or Google Cloud Run (forked option via Gemini Enterprise Agent Platform, formerly Vertex)

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

### 5. Configure Firestore Composite Indexes (Required for Chat)

The collaboration/chat thread uses indexed queries on the `comments` collection (ordered by `projectId` + `timestamp`).  
If this index is missing, chat requests can fail with a Firestore index error.

1. Install Firebase CLI (if needed): `npm i -g firebase-tools`
2. Authenticate and select your project:
   ```bash
   firebase login
   firebase use <your-firebase-project-id>
   ```
3. Deploy indexes from this repository:
   ```bash
   firebase deploy --only firestore:indexes
   ```
4. Confirm in Firebase Console → Firestore Database → **Indexes** that the `comments` composite index is enabled.

> Source of truth: `firestore.indexes.json`.

### 6. Add Environment Variables

Create a file named `.env` in the root of the project.  
For Vercel, add the same values in **Project Settings → Environment Variables**.

```env
# Core runtime
NODE_ENV=production
APP_URL=https://your-deployment-url

# Firebase web config (client + server runtime checks)
VITE_FIREBASE_PROJECT_ID=YOUR_PROJECT_ID
VITE_FIREBASE_APP_ID=YOUR_APP_ID
VITE_FIREBASE_API_KEY=YOUR_API_KEY
VITE_FIREBASE_AUTH_DOMAIN=YOUR_AUTH_DOMAIN
VITE_FIREBASE_DATABASE_ID=(default)
VITE_FIREBASE_STORAGE_BUCKET=YOUR_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID=YOUR_MESSAGING_SENDER_ID

# Optional: Restrict team login to a specific domain (e.g., yourcompany.com)
VITE_ALLOWED_DOMAIN=yourcompany.com

# Required for role management, owner bootstrap, and Admin SDK writes
FIREBASE_PROJECT_ID=YOUR_PROJECT_ID
FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'
ELEVATED_ACCESS_INITIAL_PASSWORD=<bootstrap-password-set-via-secret-manager>

# Optional owner bootstrap allow-list (comma-separated)
OWNER_EMAILS=owner1@yourorg.com,owner2@yourorg.com

# Optional: Comma-separated browser origins allowed to call server APIs
# (recommended for production)
CORS_ALLOWED_ORIGINS=https://your-app.vercel.app

# Optional: Express trust proxy setting ("false", "true", or proxy hop count like "1")
# Defaults to "1" in production and "false" in development.
TRUST_PROXY=1

# Optional distributed rate limiting (recommended in production)
UPSTASH_REDIS_REST_URL=https://<upstash-endpoint>
UPSTASH_REDIS_REST_TOKEN=<upstash-token>

# Optional integrations for project links
VITE_PROJECT_GITHUB_BASE_URL=https://github.com/your-org/your-repo/tree/main/projects
VITE_PROJECT_DRIVE_FOLDER_BASE_URL=https://drive.google.com/drive/folders/<root-folder-id>

# Optional AI providers (server-side only; do NOT prefix with VITE_)
GEMINI_API_KEY=
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GROQ_API_KEY=
GROQ_BASE_URL=
GEMMA_API_KEY=
GEMMA_BASE_URL=
GROC_API_KEY=
GROC_BASE_URL=

# Optional operations digest delivery webhooks
SLACK_WEBHOOK_URL=
OPS_DIGEST_EMAIL_WEBHOOK_URL=
```

*(Note: Keep `.env` out of version control so API keys are never committed. This project includes `.env.example` as the template for required values.)*

### 7. Install Dependencies & Run

```bash
# Install dependencies
npm install

# Start the development server
npm run dev
```

The app will be available at `http://localhost:3000`.

### Environment Variables Checklist for Vercel

Use this checklist when configuring a production Vercel project:

**Required**
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_DATABASE_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_SERVICE_ACCOUNT_JSON`

**Strongly recommended**
- `CORS_ALLOWED_ORIGINS`
- `TRUST_PROXY`
- `OWNER_EMAILS`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

**Optional (based on features you enable)**
- `VITE_ALLOWED_DOMAIN`
- `VITE_PROJECT_GITHUB_BASE_URL`
- `VITE_PROJECT_DRIVE_FOLDER_BASE_URL`
- `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GROQ_API_KEY`, `GEMMA_API_KEY`, `GEMMA_BASE_URL`, `GROC_API_KEY`, `GROC_BASE_URL`
- `SLACK_WEBHOOK_URL`, `OPS_DIGEST_EMAIL_WEBHOOK_URL`

## Google Drive & Google Calendar Integration Setup

This app does **link integration** (deep links), not direct Google API sync.  
You configure link bases/IDs and the app generates project-specific links in record view.

### A) Google Drive setup

1. Create a shared Drive folder that will contain project subfolders.
2. Copy the folder URL (`https://drive.google.com/drive/folders/<folder-id>`).
3. Configure one of these:
   - **Global default** for all deployments: set `VITE_PROJECT_DRIVE_FOLDER_BASE_URL` in env.
   - **Runtime setting** in app: Settings → Integrations → **Google Drive base folder URL**.
4. In each project record, the app builds links as:  
   `<drive-base>/<project.code>` (normalized to Google Drive URL format).

### B) Google Calendar setup

1. In Google Calendar, open the team/shared calendar settings.
2. Copy the **Calendar ID** (example: `team-calendar@group.calendar.google.com`).
3. In app Settings → Integrations, set **Shared Google Calendar ID**.
4. Ensure projects have a `dueDate`; the “Calendar” link appears only when both `dueDate` and `googleCalendarId` are set.
5. The app opens a prefilled Google Calendar event creation URL with title + due date context for the project.

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

To ensure that only users from your organization can access the internal dashboard, you can restrict the Google Sign-In to a specific domain (e.g., `yourcompany.com`).

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

## Deploying to Vercel (Primary)

Because this project includes an Express server (`server.ts`) for secure AI/provider key handling and admin APIs, deploy it as a **Node.js app** (not static-only hosting).

1. Push your customized code to a GitHub repository.
2. Log in to Vercel and click **Add New... > Project**.
3. Import your GitHub repository.
4. Set build/runtime configuration:
   - **Build Command**: `npm run build`
   - **Install Command**: `npm install`
   - **Start Command**: `npm run start`
5. **Environment Variables**: Add all required variables from **Environment Variables Checklist for Vercel** above.
6. Click **Deploy**.

**Important Post-Deployment Step:** Once Vercel provides your live production URL (for example `https://your-app.vercel.app`), add this domain to Firebase Authentication **Authorized domains** (Authentication → Settings → Authorized domains) so Google Sign-In works correctly.

### Preventing builds/deploys from resetting persistent data

If deploys seem to "wipe memory," the root cause is usually data being kept in process memory, wrong environment variables, or build scripts that overwrite live documents.

Use this hardening checklist:

1. **Keep durable state in Firestore (or Redis), not Node process memory**
   - This project already persists global settings in `settings/global` through admin APIs.
   - Any runtime `Map`/in-memory cache should be treated as **ephemeral** and safe to lose after each cold start/deploy.
2. **Configure distributed rate limiting in production**
   - Set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
   - Without these, production falls back to per-instance in-memory limits that reset on deploy and are inconsistent across instances.
3. **Never write default settings during `npm run build`**
   - Build steps should compile assets only.
   - Seed/migration scripts must run as explicit one-off commands (not inside `build`, `postbuild`, or `start`).
4. **Pin production to the correct Firebase project/database**
   - Verify Vercel env vars: `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_DATABASE_ID`, and server credentials (`FIREBASE_SERVICE_ACCOUNT_JSON`) all point to the same production project.
   - A wrong project ID can look like "memory loss" because the app reads a different database.
5. **Protect settings from accidental overwrite**
   - Restrict settings writes to privileged users only (owner/admin), enforced by claims + Firestore rules.
   - Prefer partial updates/migrations for new fields rather than replacing the entire settings object with defaults.
6. **Add backup/restore before release**
   - Schedule Firestore exports (or equivalent backup process) before major releases.
   - Keep rollback runbooks so data can be restored quickly if a deploy script mutates production docs.

Quick pre-release check:

```bash
echo "NODE_ENV=$NODE_ENV"
echo "VITE_FIREBASE_PROJECT_ID=$VITE_FIREBASE_PROJECT_ID"
echo "VITE_FIREBASE_DATABASE_ID=$VITE_FIREBASE_DATABASE_ID"
node -e "console.log('Has FIREBASE_SERVICE_ACCOUNT_JSON:', !!process.env.FIREBASE_SERVICE_ACCOUNT_JSON)"
```

CI guard (automated on pull requests and pushes to `main`):

```bash
npm run ci:guard
```

This guard fails if:
- build/start lifecycle scripts contain risky data-mutation commands (seed/migrate/reset/wipe),
- `.env.example` is missing required production keys,
- or (when `CI_GUARD_STRICT=1`) Firebase production env values are missing/mismatched.

## AI Features & Secure API Key Handling

The Digital Archivist includes optional AI features (Auto-Tagging, Summarization, Next-best Actions, Risk Narrative Drafting, and Duplicate Detection) that can be powered by Google Gemini, OpenAI, Anthropic Claude, Groq, or any OpenAI-compatible endpoint (Gemma slot, Groc slot).

### Enabling AI Features
1. Log in as an Admin.
2. Navigate to the **Settings** tab in the sidebar.
3. Toggle **Enable AI** (master switch), choose **Active AI provider**, then enable each **product** (Auto-tag, AI summarize, next-best actions, risk narrative, duplicate detection) independently.
4. Optionally require human approval before AI drafts are treated as approved.

After upgrading, **save settings once** so Firestore includes the new fields (`aiAutoTagEnabled`, `aiSummarizeEnabled`). Deploy updated **`firestore.rules`** if clients write `settings/global` directly.

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
3. Add AI API keys as server-side environment variables (`GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.).
4. `/api/ai/generate` now requires a Firebase ID token for an authenticated user with `admin: true` custom claim.
5. Configure `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` for **distributed** rate limiting across serverless instances. If they are missing in production, the server still starts but logs a warning and falls back to per-instance in-memory limits (less reliable under load).
6. The API includes request-size limits and distributed rate limiting (including `/api/admin/settings` and `/api/admin/operations/run`), plus timeout guards on admin mutation/digest endpoints; tune these values in `server.ts` as needed.

## Forked Deployment Option: Gemini Enterprise Agent Platform (formerly Vertex)

If a partner team forks this repo and prefers Google Cloud-native deployment, deploy the same Node server to **Cloud Run** and manage secrets with **Secret Manager**.

### 1) Fork + connect Google Cloud project
1. Fork this repository to your org GitHub.
2. Create/select a Google Cloud project.
3. Enable APIs: Cloud Run, Artifact Registry, Secret Manager, IAM, Firestore, Identity Toolkit/Firebase Auth.

### 2) Build and deploy
Use Cloud Build or local Docker + `gcloud run deploy`. The runtime command must start `dist/server.cjs` (same as `npm run start`).

Example high-level flow:
1. `npm ci`
2. `npm run build`
3. Package/deploy to Cloud Run
4. Set service env vars/secrets (same keys as Vercel checklist)

### 3) Secrets + runtime config
- Store sensitive values (`FIREBASE_SERVICE_ACCOUNT_JSON`, AI keys, webhook URLs) in Secret Manager.
- Mount/inject them as env vars in the Cloud Run service.
- Set `APP_URL` to the Cloud Run service URL (or your custom domain).
- Set `CORS_ALLOWED_ORIGINS` to your frontend origin(s).

### 4) Firebase/Auth post-deploy
1. Add the Cloud Run/custom domain to Firebase Auth **Authorized domains**.
2. Deploy Firestore rules and indexes:
   ```bash
   firebase deploy --only firestore:rules,firestore:indexes
   ```
3. Validate owner bootstrap (`OWNER_EMAILS`) and role reconciliation flows.

### 5) Gemini Enterprise Agent Platform usage pattern
Use this app as the operational front-end/API while your Gemini Enterprise agent workflows run in Google Cloud.  
In practice, teams usually:
- keep this app deployed on Cloud Run,
- keep Firestore/Auth in the same GCP project,
- and route AI/provider calls via server-managed keys per environment.

## Data Visibility & Access Model

- Default posture is **private by default**: `projects` are readable only by authenticated users unless `settings/global.privacyMode` is explicitly set to `public-read`.
- AI draft payloads (`aiDrafts`) are only valid when `settings/global.privacyMode` is `private-read`; in `public-read` mode they are blocked by Firestore rules to avoid exposing internal draft content.
- Project writes are admin-only and validated against a strict allow-list to avoid sensitive fields.
- `comments` are internal-only (`isAuthenticated()` read; create/update/delete restricted by ownership/admin), with optional mention/reaction/thread/attachment metadata validated by rules.
- `settings` are authenticated-read and admin-write.

If your organization needs public showcase behavior, explicitly set `settings/global.privacyMode` to `public-read` and review the deployment hardening checklist in `OPEN_SOURCE.md`.

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
