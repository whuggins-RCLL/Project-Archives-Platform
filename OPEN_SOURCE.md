# Open-Source Posture

This repository is intended to be safe to publish when operated with environment-managed secrets.

## No secrets committed

- Never commit API keys, tokens, service-account JSON, private IDs, or real user data.
- Keep `.env`, `.env.local`, and other secret-bearing files out of source control.
- Use placeholders in docs and sample configs only.

## Required environment variables

At minimum, configure these for secure operation:

- `FIREBASE_PROJECT_ID`
- `FIREBASE_SERVICE_ACCOUNT_JSON`
- `ELEVATED_ACCESS_INITIAL_PASSWORD` (required to bootstrap elevated access, and required in production)
- Firebase web config values (`VITE_FIREBASE_*`)

Commonly required in production:

- `OWNER_EMAILS` (owner bootstrap allow-list)
- `CORS_ALLOWED_ORIGINS`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

## Security reporting process

- Report vulnerabilities privately to: `security@your-organization.example`.
- Include reproduction steps, affected versions, and potential impact.
- Avoid public disclosure until maintainers confirm remediation and disclosure timing.

## Deployment hardening checklist

- [ ] Set `CORS_ALLOWED_ORIGINS` to trusted origins only.
- [ ] Configure `OWNER_EMAILS` with explicit owner accounts.
- [ ] Provide `FIREBASE_SERVICE_ACCOUNT_JSON` via your platform secret manager.
- [ ] Set `ELEVATED_ACCESS_INITIAL_PASSWORD` via secret manager (never in source).
- [ ] Keep Firestore rules and indexes deployed and in sync.
- [ ] Verify debug routes (for example `/api/debug/env`) are inaccessible in production.
- [ ] Confirm sample configs, screenshots, and release notes contain no sensitive identifiers.
