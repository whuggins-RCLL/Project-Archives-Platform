import { useEffect, useState } from 'react';
import { onIdTokenChanged } from 'firebase/auth';
import { auth } from '../lib/firebase';
import {
  AppRole,
  canEditContent,
  canManageRoles,
  canManageSettings,
  canViewInternalStats,
  isAdminRole,
  isOwnerRole,
  normalizeRoleFromClaims,
  roleLabel,
} from '../lib/roles';

export function useUserRole() {
  const [role, setRole] = useState<AppRole>('viewer');
  const [loadingRole, setLoadingRole] = useState(true);

  useEffect(() => {
    const unsubscribe = onIdTokenChanged(auth, async (user) => {
      if (!user) {
        setRole('viewer');
        setLoadingRole(false);
        return;
      }

      try {
        const tokenResult = await user.getIdTokenResult(true);
        setRole(normalizeRoleFromClaims(tokenResult?.claims ?? {}));
      } catch {
        console.error('Failed to resolve user role');
        setRole('viewer');
      } finally {
        setLoadingRole(false);
      }
    });

    return () => unsubscribe();
  }, []);

  return {
    role,
    isOwner: isOwnerRole(role),
    isAdmin: isAdminRole(role),
    isCollaborator: role === 'collaborator',
    isViewer: role === 'viewer',
    canManageRoles: canManageRoles(role),
    canManageSettings: canManageSettings(role),
    canEditContent: canEditContent(role),
    canViewInternalStats: canViewInternalStats(role),
    loadingRole,
    roleLabel: roleLabel(role),
  };
}
