/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { Menu, X } from 'lucide-react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth, isFirebaseConfigured, missingFirebaseConfigKeys } from './lib/firebase';
import Sidebar from './components/Sidebar';
import Topbar from './components/Topbar';
import KanbanView from './views/KanbanView';
import PriorityView from './views/PriorityView';
import PortfolioView from './views/PortfolioView';
import RecordView from './views/RecordView';
import PublicView from './views/PublicView';
import LoginView from './views/LoginView';
import SettingsView from './views/SettingsView';
import AdminUsersView from './views/AdminUsersView';
import { api } from './lib/api';
import { useUserRole } from './hooks/useUserRole';
import { buildDefaultApprovalCheckpoints, buildDefaultMilestones } from './lib/projectGovernance';

import { Project } from './types';

function InternalApp() {
  const [currentView, setCurrentView] = useState('kanban');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [isNewProjectModalOpen, setIsNewProjectModalOpen] = useState(false);
  const [newProjectTitle, setNewProjectTitle] = useState('');
  const [isSidebarMobileOpen, setIsSidebarMobileOpen] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const { canEditContent, canManageRoles, canManageSettings, loadingRole, roleLabel } = useUserRole();
  const modalRef = useRef<HTMLDivElement | null>(null);
  const mainContentRef = useRef<HTMLElement | null>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);
  const modalTitleId = 'new-project-modal-title';

  useEffect(() => {
    if (!isNewProjectModalOpen) return;

    previousActiveElementRef.current = document.activeElement as HTMLElement | null;

    const focusableSelectors = [
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      'a[href]',
      '[tabindex]:not([tabindex="-1"])',
    ].join(', ');

    const modalElement = modalRef.current;
    const focusableElements: HTMLElement[] = modalElement
      ? Array.from(modalElement.querySelectorAll(focusableSelectors)) as HTMLElement[]
      : [];

    if (focusableElements.length > 0) {
      focusableElements[0].focus();
    } else {
      modalElement?.focus();
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setIsNewProjectModalOpen(false);
        return;
      }

      if (event.key !== 'Tab' || focusableElements.length === 0) return;

      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previousActiveElementRef.current?.focus();
    };
  }, [isNewProjectModalOpen]);

  useEffect(() => {
    const unsubscribe = api.subscribeToProjects(
      (data) => {
        setProjects(data);
        setLoadingProjects(false);
      },
      (error) => {
        console.error("Failed to subscribe to projects:", error);
        setLoadingProjects(false);
      }
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (isNewProjectModalOpen) return;

    const focusMainContent = window.requestAnimationFrame(() => {
      mainContentRef.current?.focus();
    });

    return () => window.cancelAnimationFrame(focusMainContent);
  }, [currentView, selectedProjectId, isNewProjectModalOpen]);

  const handleProjectClick = (id: string) => {
    setSelectedProjectId(id);
    setCurrentView('record');
  };

  const openNewProjectModal = () => {
    if (!canEditContent) return;
    setIsNewProjectModalOpen(true);
  };

  const handleProjectsRefreshed = (refreshedProjects: Project[]) => {
    setProjects(refreshedProjects);
  };

  const handleNewProject = async () => {
    if (!newProjectTitle.trim()) return;
    try {
      await api.createProject({
        title: newProjectTitle,
        description: 'New project description',
        status: 'Intake / Proposed',
        priority: 'Medium',
        owner: { name: auth.currentUser?.displayName || 'Current User', initials: auth.currentUser?.displayName?.substring(0, 2).toUpperCase() || 'CU', avatar: auth.currentUser?.photoURL || '' },
        tags: [],
        progress: 0,
        department: 'General',
        riskFactor: 'Low',
        preservationScore: 0,
        milestones: buildDefaultMilestones(),
        dependencies: [],
        approvalCheckpoints: buildDefaultApprovalCheckpoints()
      });
      setIsNewProjectModalOpen(false);
      setNewProjectTitle('');
      setCurrentView('kanban');
    } catch (error) {
      console.error('Failed to create project:', error);
    }
  };

  const renderView = () => {
    switch (currentView) {
      case 'kanban':
        return <KanbanView projects={projects} loading={loadingProjects} onProjectClick={handleProjectClick} onNewProject={openNewProjectModal} isAdmin={canEditContent} />;
      case 'priority':
        return <PriorityView projects={projects} loading={loadingProjects} onProjectClick={handleProjectClick} />;
      case 'portfolio':
        return <PortfolioView projects={projects} loading={loadingProjects} onProjectClick={handleProjectClick} onProjectsRefreshed={handleProjectsRefreshed} />;
      case 'record':
        return <RecordView projects={projects} loading={loadingProjects} projectId={selectedProjectId} onBack={() => setCurrentView('kanban')} isAdmin={canEditContent} />;
      case 'settings':
        return <SettingsView isAdmin={canManageSettings} loadingRole={loadingRole} />;
      case 'admin-users':
        return <AdminUsersView canManageRoles={canManageRoles} />;
      default:
        return <KanbanView projects={projects} loading={loadingProjects} onProjectClick={handleProjectClick} onNewProject={openNewProjectModal} isAdmin={canEditContent} />;
    }
  };

  return (
    <div className="flex min-h-screen bg-surface text-on-surface font-body">
      <Sidebar
        currentView={currentView}
        setCurrentView={setCurrentView}
        onNewProject={openNewProjectModal}
        canEditContent={canEditContent}
        canManageSettings={canManageSettings}
        canManageRoles={canManageRoles}
        isMobileOpen={isSidebarMobileOpen}
        onMobileClose={() => setIsSidebarMobileOpen(false)}
      />
      <div className="flex-1 lg:ml-64 flex flex-col">
        <button
          onClick={() => setIsSidebarMobileOpen((prev) => !prev)}
          className="lg:hidden fixed top-4 left-4 z-[60] p-2 rounded-md bg-surface-container-low border border-outline-variant/30 text-on-surface"
          aria-label={isSidebarMobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
        >
          {isSidebarMobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
        <Topbar
          roleLabel={roleLabel}
          onOpenSettings={() => setCurrentView('settings')}
          canManageSettings={canManageSettings}
        />
        <main
          ref={mainContentRef}
          tabIndex={-1}
          className="flex-1 relative focus:outline-none"
        >
          {renderView()}
        </main>
      </div>

      {/* Global New Project Modal */}
      {isNewProjectModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={modalTitleId}
            tabIndex={-1}
            className="bg-surface-container-lowest w-full max-w-md rounded-xl shadow-2xl overflow-hidden"
          >
            <div className="flex justify-between items-center p-6 border-b border-outline-variant/20">
              <h3 id={modalTitleId} className="font-headline text-xl font-bold text-on-surface">Create New Project</h3>
              <button 
                onClick={() => setIsNewProjectModalOpen(false)}
                className="text-on-surface-variant hover:text-on-surface transition-colors"
                aria-label="Close new project dialog"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6">
              <label htmlFor="new-project-title" className="block text-sm font-bold text-on-surface-variant mb-2">Project Title</label>
              <input 
                id="new-project-title"
                type="text" 
                value={newProjectTitle}
                onChange={(e) => setNewProjectTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleNewProject()}
                className="w-full bg-surface-container-low border border-outline-variant/30 rounded-lg p-3 focus:ring-2 focus:ring-primary outline-none"
                placeholder="e.g., Semantic Search for Archives"
              />
            </div>
            <div className="p-6 bg-surface-container-low flex justify-end gap-3 border-t border-outline-variant/20">
              <button 
                onClick={() => setIsNewProjectModalOpen(false)}
                className="px-4 py-2 text-sm font-bold text-on-surface-variant hover:bg-surface-container-high rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={handleNewProject}
                disabled={!canEditContent || !newProjectTitle.trim()}
                className="px-6 py-2 text-sm font-bold bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Create Project
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ProtectedRoute({ children, isAuthenticated, isLoading }: { children: React.ReactNode, isAuthenticated: boolean, isLoading: boolean }) {
  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center bg-surface">Loading...</div>;
  }
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setIsLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        const allowedDomain = import.meta.env.VITE_ALLOWED_DOMAIN;
        if (allowedDomain && user.email && !user.email.endsWith(`@${allowedDomain}`)) {
          await signOut(auth);
          setIsAuthenticated(false);
        } else {
          setIsAuthenticated(true);
        }
      } else {
        setIsAuthenticated(false);
      }
      setIsLoading(false);
    });
    return () => unsubscribe();
  }, []);

  if (!isFirebaseConfigured) {
    return (
      <div className="min-h-screen bg-surface text-on-surface flex items-center justify-center p-6">
        <div className="w-full max-w-2xl rounded-2xl border border-outline-variant/40 bg-surface-container-lowest shadow-xl p-8 space-y-5">
          <h1 className="font-headline text-2xl font-bold">Setup required before the app is available</h1>
          <p className="text-on-surface-variant">
            This app cannot load yet because Firebase environment variables are missing. Add the keys below in your Vercel environment variables for this deployment target, then redeploy.
          </p>
          <ul className="list-disc pl-6 text-sm text-on-surface-variant space-y-1">
            {missingFirebaseConfigKeys.map((key) => (
              <li key={key}>{key}</li>
            ))}
          </ul>
          <p className="text-sm text-on-surface-variant">
            Optional note: once deployed, add your Vercel domain to Firebase Authentication {'->'} Authorized domains so login works.
          </p>
        </div>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<PublicView />} />
        <Route path="/login" element={<LoginView />} />
        <Route 
          path="/app/*" 
          element={
            <ProtectedRoute isAuthenticated={isAuthenticated} isLoading={isLoading}>
              <InternalApp />
            </ProtectedRoute>
          } 
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
