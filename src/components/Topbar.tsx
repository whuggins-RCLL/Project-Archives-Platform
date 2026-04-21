import { Search, Bell, Settings, LogOut, XCircle, CheckCircle2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { APP_CONFIG } from '../config';
import { useMemo, useState } from 'react';
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
  canUseRolePreview,
  rolePreviewMode,
  onRolePreviewModeChange,
}: {
  roleLabel: string,
  rawRole: string,
  /** Signed-in role label (unchanged while previewing). */
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
    <header className="bg-white/85 backdrop-blur-xl sticky top-0 z-30 w-full shadow-[0_8px_32px_rgba(25,28,30,0.06)]">
      <div className="flex justify-between items-center px-10 h-16">
      <div className="flex items-center space-x-8 min-w-0">
        <div className="min-w-0 hidden sm:block max-w-[min(22rem,40vw)]">
          <p className="font-headline text-lg sm:text-xl font-bold text-brand-dark tracking-tight truncate" title={branding.portalName || APP_CONFIG.portalName}>
            {branding.portalName || APP_CONFIG.portalName}
          </p>
          <p className="text-[11px] text-on-surface-variant truncate mt-0.5" title={branding.suiteName || APP_CONFIG.appName}>
            {branding.suiteName || APP_CONFIG.appName}
          </p>
        </div>
        <p className="sm:hidden font-headline text-lg font-bold text-brand-dark truncate max-w-[42vw]" title={branding.portalName || APP_CONFIG.portalName}>
          {branding.portalName || APP_CONFIG.portalName}
        </p>
        <div className="relative md:hidden">
          <label htmlFor="topbar-search-mobile" className="sr-only">Search Archives</label>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant w-4 h-4" />
          <input
            id="topbar-search-mobile"
            className="bg-surface-container-low border-none rounded-full pl-10 pr-4 py-1.5 text-sm w-40 focus:ring-2 focus:ring-primary-container transition-all outline-none"
            placeholder="Search..."
            type="text"
          />
        </div>
        <div className="relative hidden md:block">
          <label htmlFor="topbar-search-desktop" className="sr-only">Search Archives</label>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant w-4 h-4" />
          <input
            id="topbar-search-desktop"
            className="bg-surface-container-low border-none rounded-full pl-10 pr-4 py-1.5 text-sm w-64 focus:ring-2 focus:ring-primary-container transition-all outline-none"
            placeholder="Search Archives..."
            type="text"
          />
        </div>
      </div>
      <div className="flex items-center space-x-6">
        <div className="hidden lg:flex flex-col items-end gap-1">
          <button
            type="button"
            className="text-[11px] px-2 py-1 border rounded-md hover:bg-slate-50 disabled:opacity-60"
            onClick={() => void onRefreshPermissions()}
            disabled={refreshingRole}
          >
            {refreshingRole ? 'Refreshing permissions…' : 'Refresh permissions'}
          </button>
          {roleError && <p className="text-[10px] text-error">{roleError}</p>}
        </div>
        <div className="flex space-x-2 relative">
          <button
            aria-label="Open notifications. You have unread notifications"
            title="Notifications"
            onClick={() => setNotificationsOpen((prev) => !prev)}
            className="p-2 text-slate-700 hover:bg-slate-100 rounded-full transition-colors relative"
          >
            <Bell className="w-5 h-5" />
            <span className="sr-only">Unread notifications</span>
            <span
              aria-hidden="true"
              className="absolute top-2 right-2 w-2 h-2 bg-error rounded-full border-2 border-white"
            ></span>
          </button>
          {notificationsOpen && (
            <div className="absolute right-20 top-14 w-80 rounded-lg border border-outline-variant/30 bg-surface-container-lowest shadow-xl p-3 z-50">
              <div className="text-xs font-bold uppercase text-on-surface-variant mb-2">Notifications</div>
              <div className="space-y-2">
                {notifications.map((item) => (
                  <div key={item.id} className="rounded-md bg-surface-container-low p-2">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <item.icon className="w-4 h-4 text-primary" />
                      {item.title}
                    </div>
                    <p className="text-xs text-on-surface-variant mt-1">{item.detail}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          <button
            aria-label="Open settings"
            title={
              canViewSettings
                ? (canManageSettings ? 'Settings' : 'Settings (view-only access)')
                : 'Settings unavailable'
            }
            onClick={onOpenSettings}
            disabled={!canViewSettings}
            className={`p-2 rounded-full transition-colors ${
              canViewSettings
                ? 'text-slate-700 hover:bg-slate-100'
                : 'text-slate-400 hover:bg-slate-100'
            }`}
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
        <div className="h-8 w-[1px] bg-slate-200 hidden md:block"></div>
        <div className="flex items-center space-x-3 pl-2">
          <div className="text-right hidden md:block">
            <p className="text-xs font-bold text-brand-dark">{auth.currentUser?.displayName || 'Librarian Alpha'}</p>
            <p className="text-[10px] text-on-surface-variant" title={`Role key: ${rawRole}`}>{roleLabel}</p>
            {canUseRolePreview && rolePreviewMode !== 'off' && (
              <p className="text-[9px] text-amber-800 font-medium" title="Your signed-in role">
                Account: {actualRoleLabel}
              </p>
            )}
            <p className="text-[9px] text-on-surface-variant/80" title="Role debug source">
              Token: {tokenRoleSnapshot} | Mirror: {mirrorRoleSnapshot ?? 'none'}
            </p>
          </div>
          <img
            alt="Librarian Profile"
            className="w-9 h-9 rounded-full object-cover border-2 border-primary-container/20"
            src={auth.currentUser?.photoURL || "https://lh3.googleusercontent.com/aida-public/AB6AXuCrUohiq7QaL3CoEGKLCQXm_0DX3H64LvxWn_3O2RnliwqAX1kozCZ-4UQSStVHxP1i1KCvCa75Bg3m8YvYZ-1cqm_RZJF2CBihZv--y4riJjpXDdzdTmj96F6p_Acw0cWGfYYGT_v5cEznpL-Ps327O0tY9NkU5yEOYdyTAL9Wjx0vLHJJqTtfHpU3F21uqhWz5brZJvwUUdAEhbwLLuENJdZsKoGJuF6OCGX-mss6_U3cDu0N20cwzOQ9Iikj22mUrKZSPsu1eg"}
          />
          <button 
            onClick={handleLogout}
            aria-label="Log out"
            className="p-2 text-slate-700 hover:text-error hover:bg-error/10 rounded-full transition-colors ml-2 inline-flex items-center gap-2"
            title="Log out"
          >
            <LogOut className="w-5 h-5" />
            <span className="hidden lg:inline text-xs font-bold">Sign out</span>
          </button>
        </div>
      </div>
      </div>
      {canUseRolePreview && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-amber-200/60 bg-amber-50/95 px-10 py-2 text-sm">
          <label htmlFor="role-preview-select" className="text-on-surface-variant shrink-0 font-medium">
            View as
          </label>
          <select
            id="role-preview-select"
            className="rounded-md border border-outline-variant/40 bg-white px-2 py-1.5 text-sm text-on-surface shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
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
