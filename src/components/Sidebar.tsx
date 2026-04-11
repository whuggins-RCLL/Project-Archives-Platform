import { FolderArchive, Kanban, AlertCircle, Calendar, Plus, HelpCircle, Settings2, X, Users } from 'lucide-react';
import { APP_CONFIG } from '../config';
import Button from './Button';

export default function Sidebar({
  currentView,
  setCurrentView,
  onNewProject,
  canEditContent,
  canManageSettings,
  canManageRoles,
  isMobileOpen,
  onMobileClose
}: {
  currentView: string,
  setCurrentView: (v: string) => void,
  onNewProject: () => void,
  canEditContent: boolean,
  canManageSettings: boolean,
  canManageRoles: boolean,
  isMobileOpen: boolean,
  onMobileClose: () => void
}) {
  const navItems = [
    { id: 'kanban', icon: Kanban, label: 'Kanban Board' },
    { id: 'priority', icon: AlertCircle, label: 'Priority Matrix' },
    { id: 'portfolio', icon: Calendar, label: 'Portfolio Overview' },
  ];

  const handleHelpClick = () => {
    window.open('/', '_blank', 'noopener,noreferrer');
    onMobileClose();
  };

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity duration-200 lg:hidden ${isMobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        onClick={onMobileClose}
      />
      <aside className={`h-screen w-64 fixed left-0 top-0 z-50 bg-slate-50 flex flex-col py-8 px-6 space-y-4 transform transition-transform duration-200 lg:z-40 lg:translate-x-0 ${isMobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
      <button
        onClick={onMobileClose}
        className="lg:hidden absolute top-4 right-4 text-slate-500 hover:text-brand-dark transition-colors"
        aria-label="Close sidebar"
      >
        <X className="w-5 h-5" />
      </button>
      <div className="mb-8 px-2 flex items-center space-x-3">
        <div className="w-10 h-10 bg-primary-container rounded-lg flex items-center justify-center">
          <FolderArchive className="text-white w-5 h-5" />
        </div>
        <div>
          <p className="font-headline text-lg font-bold text-brand-dark leading-tight" aria-label="Portal name">{APP_CONFIG.portalName}</p>
          <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant opacity-60">{APP_CONFIG.appName}</p>
        </div>
      </div>
      <nav className="flex-1 space-y-1">
        {navItems.map((item) => {
          const isActive = currentView === item.id;
          return (
            <button
              key={item.id}
              onClick={() => {
                setCurrentView(item.id);
                onMobileClose();
              }}
              className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-all duration-200 ${
                isActive
                  ? 'bg-white text-brand-dark shadow-sm'
                  : 'text-slate-600 hover:text-brand-dark hover:bg-slate-200/50'
              }`}
            >
              <item.icon className={`w-5 h-5 ${isActive ? '' : 'group-hover:translate-x-1 transition-transform'}`} />
              <span className="font-inter text-sm font-medium tracking-wide">{item.label}</span>
            </button>
          );
        })}
      </nav>
      <div className="pt-6 border-t border-slate-200/50 space-y-1">
        <Button 
          onClick={() => {
            onNewProject();
            onMobileClose();
          }}
          disabled={!canEditContent}
          variant="primary"
          className="w-full py-3 rounded-lg"
        >
          <Plus className="w-4 h-4" />
          <span>New Project</span>
        </Button>
        <div className="h-4"></div>
        <button
          onClick={handleHelpClick}
          className="w-full flex items-center space-x-3 px-4 py-2 text-slate-600 hover:text-brand-dark text-xs font-medium"
        >
          <HelpCircle className="w-4 h-4" />
          <span>Help</span>
        </button>
        {canManageSettings && (
          <button 
            onClick={() => {
              setCurrentView('settings');
              onMobileClose();
            }}
            className="w-full flex items-center space-x-3 px-4 py-2 text-slate-600 hover:text-brand-dark text-xs font-medium"
          >
            <Settings2 className="w-4 h-4" />
            <span>Archive Settings</span>
          </button>
        )}
        {canManageRoles && (
          <button
            onClick={() => {
              setCurrentView('admin-users');
              onMobileClose();
            }}
            className="w-full flex items-center space-x-3 px-4 py-2 text-slate-600 hover:text-brand-dark text-xs font-medium"
          >
            <Users className="w-4 h-4" />
            <span>Access Management</span>
          </button>
        )}
      </div>
    </aside>
    </>
  );
}
