import { Search, Bell, Settings, LogOut } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { APP_CONFIG } from '../config';

export default function Topbar({
  roleLabel,
  onOpenSettings,
  canManageSettings,
}: {
  roleLabel: string,
  onOpenSettings: () => void,
  canManageSettings: boolean,
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
      <div className="flex items-center space-x-8">
        <span className="text-2xl font-black tracking-tighter text-brand-dark font-headline">{APP_CONFIG.appName}</span>
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
        <div className="flex space-x-2">
          <button
            aria-label="Open notifications. You have unread notifications"
            title="Notifications"
            className="p-2 text-slate-700 hover:bg-slate-100 rounded-full transition-colors relative"
          >
            <Bell className="w-5 h-5" />
            <span className="sr-only">Unread notifications</span>
            <span
              aria-hidden="true"
              className="absolute top-2 right-2 w-2 h-2 bg-error rounded-full border-2 border-white"
            ></span>
          </button>
          <button
            aria-label="Open settings"
            title="Settings"
            onClick={onOpenSettings}
            disabled={!canManageSettings}
            className="p-2 text-slate-700 hover:bg-slate-100 rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
        <div className="h-8 w-[1px] bg-slate-200 hidden md:block"></div>
        <div className="flex items-center space-x-3 pl-2">
          <div className="text-right hidden md:block">
            <p className="text-xs font-bold text-brand-dark">{auth.currentUser?.displayName || 'Librarian Alpha'}</p>
            <p className="text-[10px] text-on-surface-variant">{roleLabel}</p>
          </div>
          <img
            alt="Librarian Profile"
            className="w-9 h-9 rounded-full object-cover border-2 border-primary-container/20"
            src={auth.currentUser?.photoURL || "https://lh3.googleusercontent.com/aida-public/AB6AXuCrUohiq7QaL3CoEGKLCQXm_0DX3H64LvxWn_3O2RnliwqAX1kozCZ-4UQSStVHxP1i1KCvCa75Bg3m8YvYZ-1cqm_RZJF2CBihZv--y4riJjpXDdzdTmj96F6p_Acw0cWGfYYGT_v5cEznpL-Ps327O0tY9NkU5yEOYdyTAL9Wjx0vLHJJqTtfHpU3F21uqhWz5brZJvwUUdAEhbwLLuENJdZsKoGJuF6OCGX-mss6_U3cDu0N20cwzOQ9Iikj22mUrKZSPsu1eg"}
          />
          <button 
            onClick={handleLogout}
            aria-label="Log out"
            className="p-2 text-slate-700 hover:text-error hover:bg-error/10 rounded-full transition-colors ml-2"
            title="Log out"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </div>
    </header>
  );
}
