import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchRoleFromUserClaims, refreshRoleWithRetry, ClaimsUser } from './roleClaims';

function makeUser(overrides: Partial<ClaimsUser> = {}): ClaimsUser {
  return {
    getIdToken: async () => 'token',
    getIdTokenResult: async () => ({ claims: { role: 'viewer' } }),
    ...overrides,
  };
}

test('fetchRoleFromUserClaims reads role from custom claims', async () => {
  const user = makeUser({
    getIdTokenResult: async () => ({ claims: { role: 'admin' } }),
  });
  const role = await fetchRoleFromUserClaims(user, false);
  assert.equal(role, 'admin');
});

test('fetchRoleFromUserClaims forces token refresh when requested', async () => {
  let forceSeen = false;
  const user = makeUser({
    getIdTokenResult: async (forceRefresh?: boolean) => {
      forceSeen = Boolean(forceRefresh);
      return { claims: { role: 'viewer' } };
    },
  });
  await fetchRoleFromUserClaims(user, true);
  assert.equal(forceSeen, true);
});

test('refreshRoleWithRetry retries transient failures and returns updated role', async () => {
  let attempts = 0;
  const user = makeUser({
    getIdTokenResult: async () => {
      attempts += 1;
      if (attempts < 2) throw new Error('stale token');
      return { claims: { role: 'owner' } };
    },
  });

  const role = await refreshRoleWithRetry(user, { retries: 2, retryDelayMs: 1 });
  assert.equal(role, 'owner');
  assert.equal(attempts, 2);
});
