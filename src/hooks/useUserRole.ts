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
  hasMinimumRole,
  isAdminRole,
  isOwnerRole,
  roleLabel,
} from '../lib/roles';
import { fetchRoleFromUserClaims, refreshRoleWithRetry } from '../lib/roleClaims';
import { api } from '../lib/api';

const VALID_ROLES: AppRole[] = ['owner', 'admin', 'collaborator', 'viewer'];

export function useUserRole() {
  const [role, setRole] = useState<AppRole>('viewer');
  const [loadingRole, setLoadingRole] = useState(true);
  const [refreshingRole, setRefreshingRole] = useState(false);
  const [roleError, setRoleError] = useState<string | null>(null);

  // Track the last role returned by the server's reconcile endpoint so that
  // background token refreshes (via onIdTokenChanged) don't downgrade the
  // displayed role before Firebase propagates the updated custom claims.
  const serverRoleRef = useRef<AppRole | null>(null);

  const resolveRole = useCallback(async (forceRefresh = false) => {
    const user = auth.currentUser;
    if (!user) {
      setRole('viewer');
      serverRoleRef.current = null;
      setLoadingRole(false);
      setRoleError(null);
      return;
    }

    try {
      if (forceRefresh) {
        // Ask the server for the authoritative role. The server reads custom
        // claims via the Identity Toolkit admin API and applies owner bootstrap
        // if the signed-in email is in OWNER_EMAILS but claims are stale.
        try {
          const result = await api.reconcileRole();
          if (VALID_ROLES.includes(result.role as AppRole)) {
            const authoritative = result.role as AppRole;
            serverRoleRef.current = authoritative;
            setRole(authoritative);
            setRoleError(null);
            // Kick off a background token refresh so the ID-token claims
            // eventually catch up; don't await—the server response is already
            // authoritative and we don't want to re-read stale claims.
            user.getIdTokenResult(true).catch(() => {});
            return;
          }
        } catch {
          // Server reconciliation failed; fall through to token-based refresh
        }
      }

      // Read role from the Firebase ID token claims (local).
      const tokenRole = forceRefresh
        ? await refreshRoleWithRetry(user)
        : await fetchRoleFromUserClaims(user, false);

      // Guard against downgrade: if the server previously confirmed a higher
      // role, keep it until the token claims catch up.
      const authoritative = serverRoleRef.current;
      if (authoritative && !hasMinimumRole(tokenRole, authoritative)) {
        setRole(authoritative);
      } else {
        // Token role has caught up (or exceeded); clear the override.
        serverRoleRef.current = null;
        setRole(tokenRole);
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
