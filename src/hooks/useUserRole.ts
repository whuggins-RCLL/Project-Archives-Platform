import { useCallback, useEffect, useState } from 'react';
import { onIdTokenChanged } from 'firebase/auth';
import { auth } from '../lib/firebase';
import {
  AppRole,
  canEditContent,
  canManageRoles,
  canManageSettings,
  canViewSettings,
  canViewInternalStats,
  isAdminRole,
  isOwnerRole,
  roleLabel,
} from '../lib/roles';
import { fetchRoleFromUserClaims, refreshRoleWithRetry } from '../lib/roleClaims';
import { api } from '../lib/api';

export function useUserRole() {
  const [role, setRole] = useState<AppRole>('viewer');
  const [loadingRole, setLoadingRole] = useState(true);
  const [refreshingRole, setRefreshingRole] = useState(false);
  const [roleError, setRoleError] = useState<string | null>(null);

  const resolveRole = useCallback(async (forceRefresh = false) => {
    const user = auth.currentUser;
    if (!user) {
      setRole('viewer');
      setLoadingRole(false);
      setRoleError(null);
      return;
    }

    try {
      if (forceRefresh) {
        try {
          await api.reconcileRole();
        } catch {
          // Server reconciliation is best-effort; proceed with token refresh
        }
      }
      const nextRole = forceRefresh
        ? await refreshRoleWithRetry(user)
        : await fetchRoleFromUserClaims(user, false);
      setRole(nextRole);
      setRoleError(null);
    } catch {
      console.error('Failed to resolve user role');
      if (!forceRefresh) {
        setRole('viewer');
      }
      setRoleError('Unable to refresh permissions. Try "Refresh permissions" again.');
    } finally {
      setLoadingRole(false);
      if (forceRefresh) {
        setRefreshingRole(false);
      }
    }
  }, []);

  const refreshRoleClaims = useCallback(async () => {
    setRefreshingRole(true);
    await resolveRole(true);
  }, [resolveRole]);

  useEffect(() => {
    const unsubscribe = onIdTokenChanged(auth, () => {
      void resolveRole(false);
    });

    return () => unsubscribe();
  }, [resolveRole]);

  return {
    role,
    isOwner: isOwnerRole(role),
    isAdmin: isAdminRole(role),
    isCollaborator: role === 'collaborator',
    isViewer: role === 'viewer',
    canManageRoles: canManageRoles(role),
    canManageSettings: canManageSettings(role),
    canViewSettings: canViewSettings(role),
    canEditContent: canEditContent(role),
    canViewInternalStats: canViewInternalStats(role),
    loadingRole,
    refreshingRole,
    roleError,
    roleLabel: roleLabel(role),
    refreshRoleClaims,
    rawRole: role,
  };
}
