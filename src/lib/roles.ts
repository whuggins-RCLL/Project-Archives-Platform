export type AppRole = 'owner' | 'admin' | 'collaborator' | 'viewer';

const ROLE_PRIORITY: Record<AppRole, number> = {
  owner: 4,
  admin: 3,
  collaborator: 2,
  viewer: 1,
};

export function normalizeRoleFromClaims(claims: Record<string, unknown> | null | undefined): AppRole {
  const roleClaim = claims?.role;
  if (roleClaim === 'owner' || roleClaim === 'admin' || roleClaim === 'collaborator' || roleClaim === 'viewer') {
    return roleClaim;
  }

  if (claims?.admin === true) {
    return 'admin';
  }

  return 'viewer';
}

export function hasMinimumRole(role: AppRole, minimum: AppRole): boolean {
  return ROLE_PRIORITY[role] >= ROLE_PRIORITY[minimum];
}

export function isOwnerRole(role: AppRole): boolean {
  return role === 'owner';
}

export function isAdminRole(role: AppRole): boolean {
  return role === 'owner' || role === 'admin';
}

export function canManageRoles(role: AppRole): boolean {
  return role === 'owner';
}

export function canManageSettings(role: AppRole): boolean {
  return role === 'owner' || role === 'admin';
}

export function canEditContent(role: AppRole): boolean {
  return role === 'owner' || role === 'admin' || role === 'collaborator';
}

export function canViewInternalStats(role: AppRole): boolean {
  return role === 'owner' || role === 'admin' || role === 'collaborator' || role === 'viewer';
}

export function roleLabel(role: AppRole): string {
  if (role === 'owner') return 'Owner';
  if (role === 'admin') return 'Admin';
  if (role === 'collaborator') return 'Collaborator';
  return 'Viewer';
}
