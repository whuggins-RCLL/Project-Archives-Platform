import { Search, Bell, Settings, LogOut, XCircle, CheckCircle2, Sun, Moon, Laptop } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { useMemo, useState } from 'react';
import type { ThemeMode } from '../lib/api';
import type { ResolvedTheme } from '../hooks/useBranding';
import { AppRole, RolePreviewMode, roleLabel as roleLabelFromKey } from '../lib/roles';

export default function Topbar({
  roleLabel,
  rawRole,
  actualRoleLabel,
  roleError,
  refreshingRole,
  onRefreshPermissions,
  onOpenSettings,
  canViewSettings,
  canManageSettings,
  branding,
  tokenRoleSnapshot,
  mirrorRoleSnapshot,
  showRefreshPermissions,
  showRoleDebug,
  themeMode,
  resolvedTheme,
  onChangeTheme,
  canUseRolePreview,
  rolePreviewMode,
  onRolePreviewModeChange,
}: {
  roleLabel: string,
  rawRole: string,
  /** The user's real signed-in role label (unchanged while previewing). */
  actualRoleLabel: string,
  roleError: string | null,
  refreshingRole: boolean,
  onRefreshPermissions: () => Promise<void>,
  onOpenSettings: () => void,
  canViewSettings: boolean,
  canManageSettings: boolean,
  branding: {
    suiteName: string;
    portalName: string;
    logoUrl?: string;
  },
  tokenRoleSnapshot: string;
  mirrorRoleSnapshot: string | null;
  showRefreshPermissions: boolean;
  showRoleDebug: boolean;
  themeMode: ThemeMode;
  resolvedTheme: ResolvedTheme;
  onChangeTheme: (next: ThemeMode) => void;
  canUseRolePreview: boolean;
  rolePreviewMode: RolePreviewMode;
  onRolePreviewModeChange: (mode: RolePreviewMode) => void;
}) {
  const navigate = useNavigate();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const notifications = useMemo(() => ([
    {
      id: 'permissions',
      title: 'Permissions loaded',
      detail: `Role: ${roleLabel}`,
      icon: CheckCircle2,
    },
    {
      id: 'settings',
      title: canManageSettings ? 'Settings access granted' : 'Settings access is read-only',
      detail: canManageSettings ? 'You can edit global settings.' : 'Ask an admin to modify global settings.',
      icon: canManageSettings ? CheckCircle2 : XCircle,
    },
  ]), [roleLabel, canManageSettings]);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      navigate('/');
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  const cycleTheme = () => {
    const next: ThemeMode = themeMode === 'light' ? 'dark' : themeMode === 'dark' ? 'system' : 'light';
    onChangeTheme(next);
  };

  const themeLabel = themeMode === 'system'
    ? `System (${resolvedTheme === 'dark' ? 'dark' : 'light'})`
    : themeMode.charAt(0).toUpperCase() + themeMode.slice(1);
  const ThemeIcon = themeMode === 'system' ? Laptop : themeMode === 'dark' ? Moon : Sun;

  const previewSelectValue =
    rolePreviewMode === 'off'
      ? 'off'
      : rolePreviewMode === 'public'
        ? 'public'
        : rolePreviewMode;

  const onPreviewSelectChange = (value: string) => {
    if (value === 'off') {
      onRolePreviewModeChange('off');
      return;
    }
    if (value === 'public') {
      onRolePreviewModeChange('public');
      return;
    }
    if (value === 'owner' || value === 'admin' || value === 'collaborator' || value === 'viewer') {
      onRolePreviewModeChange(value as AppRole);
    }
  };

  return (
    <header className="sticky top-0 z-30 w-full border-b border-outline-variant/20 bg-surface-container-lowest/85 backdrop-blur-xl">
      <div className="flex h-16 w-full items-center justify-between gap-4 px-4 sm:px-6 lg:px-10">
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <div className="relative w-full max-w-md">
          <label htmlFor="topbar-search" className="sr-only">Search archives</label>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-variant" />
          <input
            id="topbar-search"
            className="w-full rounded-full border border-outline-variant/20 bg-surface-container-low py-1.5 pl-10 pr-4 text-sm text-on-surface outline-none transition-all placeholder:text-on-surface-variant/70 focus:border-primary/50 focus:ring-2 focus:ring-primary/30"
            placeholder={`Search ${branding.suiteName || 'archives'}…`}
            type="text"
          />
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        {showRefreshPermissions && (
          <button
            type="button"
            className="hidden rounded-md border border-outline-variant/30 px-2 py-1 text-[11px] text-on-surface-variant transition-colors hover:bg-surface-container-low disabled:opacity-60 lg:inline-flex"
            onClick={() => void onRefreshPermissions()}
            disabled={refreshingRole}
            title="Refresh Firebase claims for this session"
          >
            {refreshingRole ? 'Refreshing…' : 'Refresh permissions'}
          </button>
        )}
        {showRefreshPermissions && roleError && (
          <span className="hidden text-[10px] text-error lg:inline">{roleError}</span>
        )}

        <button
          type="button"
          aria-label={`Theme: ${themeLabel}. Click to change.`}
          title={`Theme: ${themeLabel}`}
          onClick={cycleTheme}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-low"
        >
          <ThemeIcon className="h-5 w-5" />
        </button>

        <div className="relative">
          <button
            aria-label="Open notifications"
            title="Notifications"
            onClick={() => setNotificationsOpen((prev) => !prev)}
            className="relative inline-flex h-9 w-9 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-low"
          >
            <Bell className="h-5 w-5" />
            <span aria-hidden className="absolute right-2 top-2 h-2 w-2 rounded-full border-2 border-surface-container-lowest bg-error" />
          </button>
          {notificationsOpen && (
            <div className="absolute right-0 top-12 z-50 w-80 rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-3 shadow-xl">
              <div className="mb-2 text-xs font-bold uppercase tracking-wide text-on-surface-variant">Notifications</div>
              <div className="space-y-2">
                {notifications.map((item) => (
                  <div key={item.id} className="rounded-md bg-surface-container-low p-2">
                    <div className="flex items-center gap-2 text-sm font-semibold text-on-surface">
                      <item.icon className="h-4 w-4 text-primary" />
                      {item.title}
                    </div>
                    <p className="mt-1 text-xs text-on-surface-variant">{item.detail}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <button
          aria-label="Open settings"
          title={canViewSettings ? (canManageSettings ? 'Settings' : 'Settings (view-only access)') : 'Settings unavailable'}
          onClick={onOpenSettings}
          disabled={!canViewSettings}
          className={`inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors ${canViewSettings ? 'text-on-surface-variant hover:bg-surface-container-low' : 'text-on-surface-variant/50'}`}
        >
          <Settings className="h-5 w-5" />
        </button>

        <div className="mx-1 hidden h-8 w-px bg-outline-variant/30 md:block" />

        <div className="flex items-center gap-3 pl-1">
          <div className="hidden text-right md:block">
            <p className="text-xs font-semibold text-on-surface">{auth.currentUser?.displayName || 'Librarian Alpha'}</p>
            <p className="text-[10px] text-on-surface-variant" title={`Role key: ${rawRole}`}>{roleLabel}</p>
            {canUseRolePreview && rolePreviewMode !== 'off' && (
              <p className="text-[9px] font-medium text-amber-700" title="Your signed-in role">
                Account: {actualRoleLabel}
              </p>
            )}
            {showRoleDebug && (
              <p className="text-[9px] text-on-surface-variant/70" title="Role debug source">
                Token: {tokenRoleSnapshot} · Mirror: {mirrorRoleSnapshot ?? 'none'}
              </p>
            )}
          </div>
          <img
            alt=""
            aria-hidden
            className="h-9 w-9 shrink-0 rounded-full border border-outline-variant/40 object-cover"
            src={auth.currentUser?.photoURL || 'https://lh3.googleusercontent.com/aida-public/AB6AXuCrUohiq7QaL3CoEGKLCQXm_0DX3H64LvxWn_3O2RnliwqAX1kozCZ-4UQSStVHxP1i1KCvCa75Bg3m8YvYZ-1cqm_RZJF2CBihZv--y4riJjpXDdzdTmj96F6p_Acw0cWGfYYGT_v5cEznpL-Ps327O0tY9NkU5yEOYdyTAL9Wjx0vLHJJqTtfHpU3F21uqhWz5brZJvwUUdAEhbwLLuENJdZsKoGJuF6OCGX-mss6_U3cDu0N20cwzOQ9Iikj22mUrKZSPsu1eg'}
          />
          <button
            onClick={handleLogout}
            aria-label="Log out"
            className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-semibold text-on-surface-variant transition-colors hover:bg-error/10 hover:text-error"
            title="Log out"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden lg:inline">Sign out</span>
          </button>
        </div>
      </div>
      </div>
      {canUseRolePreview && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-amber-200/50 bg-amber-50/90 px-4 py-2 text-sm dark:border-amber-400/20 dark:bg-amber-950/30 sm:px-6 lg:px-10">
          <label htmlFor="role-preview-select" className="shrink-0 font-medium text-on-surface-variant">
            View as
          </label>
          <select
            id="role-preview-select"
            className="rounded-md border border-outline-variant/40 bg-surface-container-lowest px-2 py-1.5 text-sm text-on-surface shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            value={previewSelectValue}
            onChange={(e) => onPreviewSelectChange(e.target.value)}
          >
            <option value="off">Your access ({actualRoleLabel})</option>
            <option value="viewer">{roleLabelFromKey('viewer')}</option>
            <option value="collaborator">{roleLabelFromKey('collaborator')}</option>
            <option value="admin">{roleLabelFromKey('admin')}</option>
            <option value="owner">{roleLabelFromKey('owner')}</option>
            <option value="public">Public page (signed out)</option>
          </select>
          {rolePreviewMode !== 'off' && (
            <p className="text-xs text-on-surface-variant">
              {rolePreviewMode === 'public' ? (
                <>Showing the public homepage while you stay signed in.</>
              ) : (
                <>
                  UI matches <span className="font-semibold text-on-surface">{roleLabelFromKey(rolePreviewMode as AppRole)}</span>
                  {' '}(permissions are simulated).
                </>
              )}
            </p>
          )}
        </div>
      )}
    </header>
  );
}
