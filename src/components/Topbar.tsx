import { Search, Settings, LogOut, Compass } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { APP_CONFIG } from '../config';

export default function Topbar({
  roleLabel,
  rawRole,
  roleError,
  refreshingRole,
  onRefreshPermissions,
  onOpenSettings,
  onOpenTour,
  canViewSettings,
  canManageSettings,
  branding,
}: {
  roleLabel: string,
  rawRole: string,
  roleError: string | null,
  refreshingRole: boolean,
  onRefreshPermissions: () => Promise<void>,
  onOpenSettings: () => void,
  onOpenTour: () => void,
  canViewSettings: boolean,
  canManageSettings: boolean,
  branding: {
    suiteName: string;
    portalName: string;
    logoUrl?: string;
  },
}) {
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      await signOut(auth);
      navigate('/');
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  return (
    <header className="bg-white/85 backdrop-blur-xl sticky top-0 z-30 flex justify-between items-center w-full px-10 h-16 shadow-[0_8px_32px_rgba(25,28,30,0.06)]">
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
          <label htmlFor="topbar-search-mobile" className="sr-only">Search</label>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant w-4 h-4" />
          <input
            id="topbar-search-mobile"
            className="bg-surface-container-low border-none rounded-full pl-10 pr-4 py-1.5 text-sm w-40 focus:ring-2 focus:ring-primary-container transition-all outline-none"
            placeholder="Search..."
            type="text"
          />
        </div>
        <div className="relative hidden md:block">
          <label htmlFor="topbar-search-desktop" className="sr-only">Search</label>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant w-4 h-4" />
          <input
            id="topbar-search-desktop"
            className="bg-surface-container-low border-none rounded-full pl-10 pr-4 py-1.5 text-sm w-64 focus:ring-2 focus:ring-primary-container transition-all outline-none"
            placeholder="Search..."
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
        <button
          aria-label="Open site tour"
          title="Open site tour"
          onClick={onOpenTour}
          className="p-2 rounded-full transition-colors text-slate-700 hover:bg-slate-100"
        >
          <Compass className="w-5 h-5" />
        </button>
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
        <div className="h-8 w-[1px] bg-slate-200 hidden md:block"></div>
        <div className="flex items-center space-x-3 pl-2">
          <div className="text-right hidden md:block">
            <p className="text-xs font-bold text-brand-dark">{auth.currentUser?.displayName || 'Librarian Alpha'}</p>
            <p className="text-[10px] text-on-surface-variant" title={`Role key: ${rawRole}`}>{roleLabel}</p>
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
    </header>
  );
}
