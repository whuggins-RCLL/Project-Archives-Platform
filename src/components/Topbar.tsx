import { Search, Settings, LogOut, PanelLeft, Moon, Sun, Monitor } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { APP_CONFIG } from '../config';

export default function Topbar({
  roleLabel,
  rawRole,
  onOpenSettings,
  canViewSettings,
  canManageSettings,
  onToggleSidebar,
  isSidebarOpen,
  themePreference,
  onThemePreferenceChange,
  branding,
}: {
  roleLabel: string,
  rawRole: string,
  onOpenSettings: () => void,
  canViewSettings: boolean,
  canManageSettings: boolean,
  onToggleSidebar: () => void,
  isSidebarOpen: boolean,
  themePreference: 'system' | 'light' | 'dark',
  onThemePreferenceChange: (mode: 'system' | 'light' | 'dark') => void,
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
    <header className="bg-surface-container-lowest/90 backdrop-blur-xl sticky top-0 z-30 flex justify-between items-center w-full px-6 md:px-10 h-16 border-b border-outline-variant/25">
      <div className="flex items-center space-x-4 md:space-x-8 min-w-0">
        <button
          type="button"
          onClick={onToggleSidebar}
          className="hidden lg:inline-flex items-center justify-center p-2 rounded-md text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low"
          aria-label={isSidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
          title={isSidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
        >
          <PanelLeft className="w-5 h-5" />
        </button>
        <div className="min-w-0 hidden sm:block max-w-[min(22rem,40vw)]">
          <p className="font-headline text-lg sm:text-xl font-bold text-brand-dark tracking-tight truncate" title={branding.portalName || APP_CONFIG.portalName}>
            {branding.portalName || APP_CONFIG.portalName}
          </p>
        </div>
        <p className="sm:hidden font-headline text-lg font-bold text-brand-dark truncate max-w-[42vw]" title={branding.portalName || APP_CONFIG.portalName}>
          {branding.portalName || APP_CONFIG.portalName}
        </p>
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
      <div className="flex items-center space-x-4 md:space-x-6">
        <div className="hidden xl:flex items-center gap-1 rounded-full p-1 bg-surface-container-low border border-outline-variant/30">
          <button
            type="button"
            className={`p-1.5 rounded-full ${themePreference === 'light' ? 'bg-primary text-[color:var(--brand-on-primary)]' : 'text-on-surface-variant hover:bg-surface-container-high'}`}
            onClick={() => onThemePreferenceChange('light')}
            aria-label="Use light mode"
          >
            <Sun className="w-4 h-4" />
          </button>
          <button
            type="button"
            className={`p-1.5 rounded-full ${themePreference === 'dark' ? 'bg-primary text-[color:var(--brand-on-primary)]' : 'text-on-surface-variant hover:bg-surface-container-high'}`}
            onClick={() => onThemePreferenceChange('dark')}
            aria-label="Use dark mode"
          >
            <Moon className="w-4 h-4" />
          </button>
          <button
            type="button"
            className={`p-1.5 rounded-full ${themePreference === 'system' ? 'bg-primary text-[color:var(--brand-on-primary)]' : 'text-on-surface-variant hover:bg-surface-container-high'}`}
            onClick={() => onThemePreferenceChange('system')}
            aria-label="Use system theme"
          >
            <Monitor className="w-4 h-4" />
          </button>
        </div>
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
              ? 'text-on-surface hover:bg-surface-container-low'
              : 'text-on-surface-variant/60 hover:bg-surface-container-low'
          }`}
        >
          <Settings className="w-5 h-5" />
        </button>
        <div className="h-8 w-[1px] bg-outline-variant hidden md:block"></div>
        <div className="flex items-center space-x-3 pl-2">
          <div className="text-right hidden md:block">
            <p className="text-xs font-bold text-brand-dark">{auth.currentUser?.displayName || 'Librarian Alpha'}</p>
            <p className="text-[10px] text-on-surface-variant" title={`Role key: ${rawRole}`}>{roleLabel}</p>
          </div>
          <img
            alt="Librarian Profile"
            className="w-9 h-9 rounded-full object-cover border-2 border-primary-container/20"
            src={auth.currentUser?.photoURL || 'https://lh3.googleusercontent.com/aida-public/AB6AXuCrUohiq7QaL3CoEGKLCQXm_0DX3H64LvxWn_3O2RnliwqAX1kozCZ-4UQSStVHxP1i1KCvCa75Bg3m8YvYZ-1cqm_RZJF2CBihZv--y4riJjpXDdzdTmj96F6p_Acw0cWGfYYGT_v5cEznpL-Ps327O0tY9NkU5yEOYdyTAL9Wjx0vLHJJqTtfHpU3F21uqhWz5brZJvwUUdAEhbwLLuENJdZsKoGJuF6OCGX-mss6_U3cDu0N20cwzOQ9Iikj22mUrKZSPsu1eg'}
          />
          <button
            onClick={handleLogout}
            aria-label="Log out"
            className="p-2 text-on-surface hover:text-error hover:bg-error/10 rounded-full transition-colors ml-2 inline-flex items-center gap-2"
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
