import { useCallback, useEffect, useRef, useState } from 'react';
import { onIdTokenChanged } from 'firebase/auth';
import { auth } from '../lib/firebase';
import {
  AppRole,
  effectiveCapabilityFlags,
  canViewSettings,
  isAdminRole,
  isOwnerRole,
  hasMinimumRole,
  normalizeRoleFromClaims,
  roleLabel,
} from '../lib/roles';
import { refreshRoleWithRetry } from '../lib/roleClaims';
import { api } from '../lib/api';

export function useUserRole() {
  const fallbackOwnerEmail = 'whuggins@law.stanford.edu';
  const [role, setRole] = useState<AppRole>('viewer');
  const [tokenRoleSnapshot, setTokenRoleSnapshot] = useState<AppRole>('viewer');
  const [mirrorRoleSnapshot, setMirrorRoleSnapshot] = useState<AppRole | null>(null);
  const [mirrorPermissionsSnapshot, setMirrorPermissionsSnapshot] = useState<unknown>(null);
  const [tokenPermissionsSnapshot, setTokenPermissionsSnapshot] = useState<unknown>(null);
  const [loadingRole, setLoadingRole] = useState(true);
  const [refreshingRole, setRefreshingRole] = useState(false);
  const [roleError, setRoleError] = useState<string | null>(null);
  const serverRoleRef = useRef<AppRole | null>(null);

  const resolveRole = useCallback(async (forceRefresh = false) => {
    const user = auth.currentUser;
    if (!user) {
      setRole('viewer');
      setTokenRoleSnapshot('viewer');
      setMirrorRoleSnapshot(null);
      setTokenPermissionsSnapshot(null);
      setMirrorPermissionsSnapshot(null);
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
      if (forceRefresh) {
        await refreshRoleWithRetry(user);
      }
      const tokenResult = await user.getIdTokenResult(false);
      const tokenRole = normalizeRoleFromClaims(tokenResult?.claims ?? {});
      const tokenPermissions = tokenResult?.claims?.permissions;
      const mirror = await api.getCurrentUserMirrorSnapshot();
      const mirroredRole = mirror?.role ?? null;
      setTokenRoleSnapshot(tokenRole);
      setMirrorRoleSnapshot(mirroredRole);
      setTokenPermissionsSnapshot(tokenPermissions ?? null);
      setMirrorPermissionsSnapshot(mirror?.permissions ?? null);
      const emailIsFallbackOwner = (user.email || '').trim().toLowerCase() === fallbackOwnerEmail;
      const resolvedTokenRole = emailIsFallbackOwner
        ? 'owner'
        : (mirroredRole && hasMinimumRole(mirroredRole, tokenRole)
          ? mirroredRole
          : tokenRole);
      const authoritativeRole = serverRoleRef.current;
      if (forceRefresh && authoritativeRole) {
        // During a forced refresh, prefer the server-reconciled role because
        // Firebase custom claims can lag behind and return stale token claims.
        setRole(authoritativeRole);
        if (hasMinimumRole(resolvedTokenRole, authoritativeRole)) {
          serverRoleRef.current = null;
        }
      } else if (authoritativeRole && !hasMinimumRole(resolvedTokenRole, authoritativeRole)) {
        setRole(authoritativeRole);
      } else {
        setRole(resolvedTokenRole);
        if (authoritativeRole && hasMinimumRole(resolvedTokenRole, authoritativeRole)) {
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
    await resolveRole(true);
  }, [resolveRole]);

  useEffect(() => {
    const unsubscribe = onIdTokenChanged(auth, () => {
      void resolveRole(false);
    });

    return () => unsubscribe();
  }, [resolveRole]);

  const caps = effectiveCapabilityFlags(role, tokenPermissionsSnapshot, mirrorPermissionsSnapshot);

  return {
    role,
    isOwner: isOwnerRole(role),
    isAdmin: isAdminRole(role),
    isCollaborator: role === 'collaborator',
    isViewer: role === 'viewer',
    canManageRoles: caps.canManageRoles,
    canManageSettings: caps.canManageSettings,
    canViewSettings: canViewSettings(role),
    canEditContent: caps.canEditContent,
    canViewInternalStats: caps.canViewInternalStats,
    loadingRole,
    refreshingRole,
    roleError,
    roleLabel: roleLabel(role),
    refreshRoleClaims,
    rawRole: role,
    tokenRoleSnapshot,
    mirrorRoleSnapshot,
  };
}
