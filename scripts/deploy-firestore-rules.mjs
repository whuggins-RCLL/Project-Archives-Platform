import crypto from 'node:crypto';
import fs from 'node:fs';

// Deploys firestore.rules straight to the Firebase Rules API.
//
// Why not `firebase deploy`? The firebase-tools rules deploy first calls the
// firebaserules `:test` endpoint to check for compilation errors. Our deploy
// service account can create rulesets and move the release pointer, but it is
// not granted `firebaserules.rulesets.test`, so that precheck fails with HTTP
// 403 and aborts the deploy *before any rules are pushed*. That is why every
// rules change (collaborators, isPublic, artifactLinks, ...) silently failed to
// reach production and surfaced as "permission denied" in the app. We reproduce
// the two real deploy steps here (create ruleset -> update release) and skip the
// precheck the service account cannot perform.

const serviceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
const rulesPath = process.env.FIRESTORE_RULES_PATH || 'firestore.rules';

if (!serviceAccountRaw) {
  console.error('::error::FIREBASE_SERVICE_ACCOUNT_JSON is not set. Cannot deploy Firestore rules.');
  process.exit(1);
}

let serviceAccount;
try {
  serviceAccount = JSON.parse(serviceAccountRaw);
} catch (error) {
  console.error(`::error::FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON: ${error.message}`);
  process.exit(1);
}

const projectId =
  process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || serviceAccount.project_id;

if (!projectId) {
  console.error('::error::No project id found (service account project_id or FIREBASE_PROJECT_ID).');
  process.exit(1);
}

const rulesSource = fs.readFileSync(rulesPath, 'utf8');
const releaseName = `projects/${projectId}/releases/cloud.firestore`;
const RULES_BASE = 'https://firebaserules.googleapis.com/v1';

async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      iss: serviceAccount.client_email,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }),
  ).toString('base64url');
  const signature = crypto
    .createSign('RSA-SHA256')
    .update(`${header}.${payload}`)
    .sign(serviceAccount.private_key.replace(/\\n/g, '\n'), 'base64url');
  const assertion = `${header}.${payload}.${signature}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Failed to mint access token: ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

function explain403(action) {
  console.error(
    `::error::The deploy service account (${serviceAccount.client_email}) is missing permission to ${action}. ` +
      "Grant it the 'Firebase Rules Admin' role (roles/firebaserules.admin) on project " +
      `${projectId} so Firestore rules can be published.`,
  );
}

async function createRuleset(token) {
  const res = await fetch(`${RULES_BASE}/projects/${projectId}/rulesets`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      source: { files: [{ name: 'firestore.rules', content: rulesSource }] },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 403) {
    explain403('create Firestore rulesets (firebaserules.rulesets.create)');
    throw new Error(`Create ruleset failed: ${JSON.stringify(data)}`);
  }
  if (!res.ok) {
    throw new Error(`Create ruleset failed (HTTP ${res.status}): ${JSON.stringify(data)}`);
  }
  if (!data.name) {
    throw new Error(`Create ruleset returned no name: ${JSON.stringify(data)}`);
  }
  return data.name;
}

async function updateRelease(token, rulesetName) {
  const patchRes = await fetch(`${RULES_BASE}/${releaseName}`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ release: { name: releaseName, rulesetName } }),
  });

  if (patchRes.status === 404) {
    // No release exists yet: create it instead of updating.
    const postRes = await fetch(`${RULES_BASE}/projects/${projectId}/releases`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: releaseName, rulesetName }),
    });
    const postData = await postRes.json().catch(() => ({}));
    if (postRes.status === 403) {
      explain403('publish the Firestore rules release (firebaserules.releases.create)');
      throw new Error(`Create release failed: ${JSON.stringify(postData)}`);
    }
    if (!postRes.ok) {
      throw new Error(`Create release failed (HTTP ${postRes.status}): ${JSON.stringify(postData)}`);
    }
    return;
  }

  const patchData = await patchRes.json().catch(() => ({}));
  if (patchRes.status === 403) {
    explain403('update the Firestore rules release (firebaserules.releases.update)');
    throw new Error(`Update release failed: ${JSON.stringify(patchData)}`);
  }
  if (!patchRes.ok) {
    throw new Error(`Update release failed (HTTP ${patchRes.status}): ${JSON.stringify(patchData)}`);
  }
}

async function main() {
  console.log(`Publishing ${rulesPath} to project ${projectId} via the Firebase Rules API...`);
  const token = await getAccessToken();
  const rulesetName = await createRuleset(token);
  console.log(`Created ruleset ${rulesetName}`);
  await updateRelease(token, rulesetName);
  console.log(`Firestore rules published: ${releaseName} -> ${rulesetName}`);
}

main().catch((error) => {
  console.error(`::error::Firestore rules deploy failed: ${error.message}`);
  process.exit(1);
});
