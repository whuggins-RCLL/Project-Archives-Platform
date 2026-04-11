import crypto from 'node:crypto';

const serviceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID;
const email = process.argv[2];

if (!serviceAccountRaw || !projectId || !email) {
  console.error('Usage: FIREBASE_SERVICE_ACCOUNT_JSON=... FIREBASE_PROJECT_ID=... node scripts/grant-owner-by-email.mjs user@example.com');
  process.exit(1);
}

const serviceAccount = JSON.parse(serviceAccountRaw);

async function getToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/identitytoolkit',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })).toString('base64url');
  const sig = crypto.createSign('RSA-SHA256').update(`${header}.${payload}`).sign(serviceAccount.private_key.replace(/\\n/g, '\n'), 'base64url');
  const assertion = `${header}.${payload}.${sig}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data.access_token;
}

const token = await getToken();
const lookupRes = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:lookup`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify({ email: [email.toLowerCase()] }),
});
const lookup = await lookupRes.json();
if (!lookupRes.ok || !lookup.users?.[0]?.localId) throw new Error(`Lookup failed: ${JSON.stringify(lookup)}`);
const user = lookup.users[0];
const claims = user.customAttributes ? JSON.parse(user.customAttributes) : {};
claims.role = 'owner';
claims.admin = true;

const updateRes = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:update`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify({ localId: user.localId, customAttributes: JSON.stringify(claims) }),
});
const update = await updateRes.json();
if (!updateRes.ok) throw new Error(`Update failed: ${JSON.stringify(update)}`);
console.log(`Owner role granted to ${email} (${user.localId}).`);
