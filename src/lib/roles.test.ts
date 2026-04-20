import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canManageRoles,
  canManageSettings,
  canViewSettings,
  defaultPermissionsForRole,
  effectiveCapabilityFlags,
  normalizeRoleFromClaims,
} from './roles';

test('canViewSettings includes all supported roles', () => {
  assert.equal(canViewSettings('owner'), true);
  assert.equal(canViewSettings('admin'), true);
  assert.equal(canViewSettings('collaborator'), true);
  assert.equal(canViewSettings('viewer'), true);
});

test('canManageSettings stays restricted to owner/admin', () => {
  assert.equal(canManageSettings('owner'), true);
  assert.equal(canManageSettings('admin'), true);
  assert.equal(canManageSettings('collaborator'), false);
  assert.equal(canManageSettings('viewer'), false);
});

test('canManageRoles allows owner and admin', () => {
  assert.equal(canManageRoles('owner'), true);
  assert.equal(canManageRoles('admin'), true);
  assert.equal(canManageRoles('collaborator'), false);
});

test('defaultPermissionsForRole derives expected permission defaults', () => {
  assert.deepEqual(defaultPermissionsForRole('viewer'), {
    canManageRoles: false,
    canManageSettings: false,
    canEditContent: false,
    canViewInternalStats: true,
  });
});

test('normalizeRoleFromClaims preserves admin fallback compatibility', () => {
  assert.equal(normalizeRoleFromClaims({ role: 'collaborator' }), 'collaborator');
  assert.equal(normalizeRoleFromClaims({ admin: true }), 'admin');
  assert.equal(normalizeRoleFromClaims({}), 'viewer');
});

test('effectiveCapabilityFlags matches role bands when no overrides', () => {
  assert.deepEqual(
    effectiveCapabilityFlags('viewer', null, null),
    defaultPermissionsForRole('viewer')
  );
  assert.deepEqual(
    effectiveCapabilityFlags('collaborator', null, null),
    defaultPermissionsForRole('collaborator')
  );
});

test('effectiveCapabilityFlags ORs explicit permission flags with role bands', () => {
  const tokenPerms = { canEditContent: true };
  assert.equal(effectiveCapabilityFlags('viewer', tokenPerms, null).canEditContent, true);
  assert.equal(effectiveCapabilityFlags('viewer', tokenPerms, null).canManageSettings, false);
  const mirrorPerms = { canManageSettings: true };
  assert.equal(effectiveCapabilityFlags('viewer', null, mirrorPerms).canManageSettings, true);
});
