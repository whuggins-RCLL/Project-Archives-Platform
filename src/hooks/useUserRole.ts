import { useCallback, useEffect, useRef, useState } from 'react';
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
  hasMinimumRole,
  roleLabel,
} from '../lib/roles';
import { fetchRoleFromUserClaims, refreshRoleWithRetry } from '../lib/roleClaims';
import { api } from '../lib/api';

export function useUserRole() {
  const [role, setRole] = useState<AppRole>('viewer');
  const [loadingRole, setLoadingRole] = useState(true);
  const [refreshingRole, setRefreshingRole] = useState(false);
  const [roleError, setRoleError] = useState<string | null>(null);
  const serverRoleRef = useRef<AppRole | null>(null);

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
          const reconcileResult = await api.reconcileRole();
          const reconciledRole = reconcileResult.role as AppRole;
          if (reconciledRole === 'owner' || reconciledRole === 'admin' || reconciledRole === 'collaborator' || reconciledRole === 'viewer') {
            serverRoleRef.current = reconciledRole;
            setRole(reconciledRole);
          }
        } catch {
          // Server reconciliation is best-effort; proceed with token refresh
        }
      }
      const tokenRole = forceRefresh
        ? await refreshRoleWithRetry(user)
        : await fetchRoleFromUserClaims(user, false);
      const authoritativeRole = serverRoleRef.current;
      if (authoritativeRole && !hasMinimumRole(tokenRole, authoritativeRole)) {
        setRole(authoritativeRole);
      } else {
        setRole(tokenRole);
        if (authoritativeRole && hasMinimumRole(tokenRole, authoritativeRole)) {
          serverRoleRef.current = null;
        }
      }
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
    void auth.currentUser?.getIdTokenResult(true).catch(() => {});
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
