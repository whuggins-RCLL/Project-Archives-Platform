import { Settings, LogOut } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { auth } from '../lib/firebase';

export default function Topbar({
  roleLabel,
  rawRole,
  roleError,
  onOpenSettings,
  canViewSettings,
  canManageSettings,
  branding,
}: {
  roleLabel: string,
  rawRole: string,
  roleError: string | null,
  onOpenSettings: () => void,
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
    <header className="glass-nav sticky top-0 z-30 flex h-16 w-full items-center justify-between px-4 pl-16 shadow-[0_8px_32px_rgba(25,28,30,0.05)] md:px-10 lg:pl-10">
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-on-surface-variant">Workspace</p>
        <p className="truncate font-headline text-sm font-bold text-brand-dark md:text-base">
          {branding.portalName || branding.suiteName}
        </p>
      </div>
      <div className="flex items-center space-x-3 md:space-x-5">
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
              ? 'text-on-surface-variant hover:bg-surface-container-high hover:text-brand-dark'
              : 'text-on-surface-variant/45 hover:bg-surface-container-high'
          }`}
        >
          <Settings className="w-5 h-5" />
        </button>
        <div className="hidden h-8 w-px bg-outline-variant/30 md:block"></div>
        <div className="flex items-center space-x-3 pl-2">
          <div className="text-right hidden md:block">
            <p className="text-xs font-bold text-brand-dark">{auth.currentUser?.displayName || 'Librarian Alpha'}</p>
            <p className="text-[10px] text-on-surface-variant" title={`Role key: ${rawRole}`}>{roleLabel}</p>
            {roleError && <p className="text-[10px] text-error">{roleError}</p>}
          </div>
          <img
            alt="Librarian Profile"
            className="w-9 h-9 rounded-full object-cover border-2 border-primary-container/20"
            src={auth.currentUser?.photoURL || "https://lh3.googleusercontent.com/aida-public/AB6AXuCrUohiq7QaL3CoEGKLCQXm_0DX3H64LvxWn_3O2RnliwqAX1kozCZ-4UQSStVHxP1i1KCvCa75Bg3m8YvYZ-1cqm_RZJF2CBihZv--y4riJjpXDdzdTmj96F6p_Acw0cWGfYYGT_v5cEznpL-Ps327O0tY9NkU5yEOYdyTAL9Wjx0vLHJJqTtfHpU3F21uqhWz5brZJvwUUdAEhbwLLuENJdZsKoGJuF6OCGX-mss6_U3cDu0N20cwzOQ9Iikj22mUrKZSPsu1eg"}
          />
          <button
            onClick={handleLogout}
            aria-label="Log out"
            className="ml-1 inline-flex items-center gap-2 rounded-full p-2 text-on-surface-variant transition-colors hover:bg-error/10 hover:text-error md:ml-2"
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
