import { Filter, Users, Plus, MoreHorizontal, CheckCircle2, MoveDown } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { Project, ProjectStatus } from '../types';
import ProjectFilterBar, { DEFAULT_FILTER_QUERY } from '../components/ProjectFilterBar';
import { applyProjectFilters, getFilterOptions, ProjectFilterQuery } from '../lib/projectFilters';
import { useSavedViews } from '../hooks/useSavedViews';
import Button from '../components/Button';

const COLUMNS: { title: ProjectStatus; color: string; border: string }[] = [
  { title: 'Intake / Proposed', color: 'bg-on-surface-variant/40', border: 'border-slate-300' },
  { title: 'Scoping', color: 'bg-primary/40', border: 'border-primary-fixed' },
  { title: 'In Progress', color: 'bg-blue-500 animate-pulse', border: 'border-blue-600' },
  { title: 'Pilot / Testing', color: 'bg-amber-500', border: 'border-amber-500' },
  { title: 'Review / Approval', color: 'bg-purple-500', border: 'border-purple-500' },
  { title: 'Launched', color: 'bg-tertiary-fixed', border: 'border-tertiary-fixed-dim' }
];

export default function KanbanView({ projects, loading, onProjectClick, onNewProject, isAdmin }: { projects: Project[], loading: boolean, onProjectClick: (id: string) => void, onNewProject: () => void, isAdmin: boolean }) {
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [filterQuery, setFilterQuery] = useState<ProjectFilterQuery>(DEFAULT_FILTER_QUERY);
  const [keyboardDraggedProjectId, setKeyboardDraggedProjectId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ type: 'error'; text: string } | null>(null);
  const { views, saveView, deleteView } = useSavedViews('kanban');

  useEffect(() => {
    if (!statusMessage) return;
    const timeout = window.setTimeout(() => setStatusMessage(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [statusMessage]);

  const handleDragStart = (e: React.DragEvent, projectId: string) => {
    e.dataTransfer.setData('projectId', projectId);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = async (e: React.DragEvent, status: ProjectStatus) => {
    if (!isAdmin) return;
    e.preventDefault();
    const projectId = e.dataTransfer.getData('projectId');
    if (!projectId) return;

    try {
      await api.updateProject(projectId, { status });
    } catch (error) {
      console.error(error);
      setStatusMessage({ type: 'error', text: 'Unable to move card. Please try again.' });
    }
  };

  const moveProjectToStatus = async (projectId: string, status: ProjectStatus) => {
    if (!isAdmin) return;
    try {
      await api.updateProject(projectId, { status });
    } catch (error) {
      console.error(error);
      setStatusMessage({ type: 'error', text: 'Unable to move card. Please try again.' });
    }
  };

  const handleKeyboardDrag = async (e: React.KeyboardEvent, project: Project) => {
    if (!isAdmin) return;

    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setKeyboardDraggedProjectId((current) => current === project.id ? null : project.id);
      return;
    }

    if (e.key === 'Escape' && keyboardDraggedProjectId === project.id) {
      e.preventDefault();
      setKeyboardDraggedProjectId(null);
      return;
    }

    if (keyboardDraggedProjectId !== project.id) return;

    const columnIndex = COLUMNS.findIndex((column) => column.title === project.status);
    if (columnIndex < 0) return;

    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      const nextColumn = COLUMNS[columnIndex - 1];
      if (nextColumn) await moveProjectToStatus(project.id, nextColumn.title);
      return;
    }

    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      const nextColumn = COLUMNS[columnIndex + 1];
      if (nextColumn) await moveProjectToStatus(project.id, nextColumn.title);
    }
  };

  const toggleFilter = (filter: string) => {
    setActiveFilter(prev => prev === filter ? null : filter);
  };

  const filteredProjects = useMemo(() => applyProjectFilters(projects, filterQuery), [projects, filterQuery]);
  const filterOptions = useMemo(() => getFilterOptions(projects), [projects]);

  // Apply basic sorting after advanced filtering
  const getFilteredProjects = (colProjects: Project[]) => {
    let filtered = [...colProjects];
    if (activeFilter === 'priority') {
      filtered.sort((a, b) => {
        const p = { 'High': 3, 'Medium': 2, 'Low': 1 };
        return p[b.priority] - p[a.priority];
      });
    } else if (activeFilter === 'owner') {
      filtered.sort((a, b) => a.owner.name.localeCompare(b.owner.name));
    }
    return filtered;
  };

  if (loading) return <div className="p-10">Loading projects...</div>;

  return (
    <div className="p-10 min-h-screen flex flex-col relative">
      {statusMessage && (
        <div className="fixed top-6 right-6 z-50">
          <div className="px-4 py-3 rounded-lg shadow-lg border text-sm font-bold bg-error-container text-error border-error/30">
            {statusMessage.text}
          </div>
        </div>
      )}
      <header className="mb-8 flex flex-col space-y-6">
        <div className="flex justify-between items-end">
          <div>
            <h2 className="font-headline text-3xl font-extrabold tracking-tight text-on-surface">Global Project Board</h2>
            <p className="text-on-surface-variant mt-1 font-medium">Managing {filteredProjects.length} filtered streams across the library network.</p>
          </div>
          <div className="flex items-center space-x-3">
            <Button 
              onClick={() => toggleFilter('priority')}
              variant={activeFilter === 'priority' ? 'primary' : 'secondary'}
            >
              <Filter className="w-5 h-5" />
              <span>Priority</span>
            </Button>
            <Button 
              onClick={() => toggleFilter('owner')}
              variant={activeFilter === 'owner' ? 'primary' : 'secondary'}
            >
              <Users className="w-5 h-5" />
              <span>Owner</span>
            </Button>
            <div className="w-px h-8 bg-outline-variant/30 mx-2"></div>
            <Button
              onClick={onNewProject}
              disabled={!isAdmin}
              title={isAdmin ? 'Create a new project' : 'You need editor access to create projects'}
              variant="primary"
              className="px-6 py-2.5"
            >
              <Plus className="w-5 h-5" />
              <span>New Project</span>
            </Button>
          </div>
        </div>
      </header>

      <ProjectFilterBar
        query={filterQuery}
        onChange={setFilterQuery}
        onReset={() => setFilterQuery(DEFAULT_FILTER_QUERY)}
        options={filterOptions}
        savedViews={views}
        onSaveView={(name) => saveView(name, filterQuery)}
        onApplySavedView={(viewId) => {
          const selected = views.find(v => v.id === viewId);
          if (selected) setFilterQuery(selected.query);
        }}
        onDeleteSavedView={deleteView}
      />

      <div className="flex-1 overflow-x-auto pb-12 kanban-scroll">
        <p id="kanban-keyboard-instructions" className="sr-only">
          Press Enter or Space to pick up or drop a card. While picked up, use arrow keys to move it between columns. Press Escape to cancel.
        </p>
        <div className="flex h-full space-x-6 min-w-max">
          {COLUMNS.map(col => {
            const colProjects = filteredProjects.filter(p => p.status === col.title);
            const displayedProjects = getFilteredProjects(colProjects);
            
            return (
              <div 
                key={col.title}
                className="w-80 flex flex-col h-full bg-surface-container-low rounded-xl p-3"
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, col.title)}
              >
                <div className="flex items-center justify-between mb-4 px-2">
                  <div className="flex items-center space-x-2">
                    <span className={`w-2 h-2 rounded-full ${col.color}`}></span>
                    <h3 className="font-bold text-sm text-on-surface-variant tracking-wide uppercase">{col.title}</h3>
                  </div>
                  <span className="text-xs font-bold text-on-surface-variant bg-surface-container-high px-2 py-0.5 rounded">{colProjects.length}</span>
                </div>
                
                <div className="space-y-3 overflow-y-auto pr-1 kanban-scroll flex-1">
                  {displayedProjects.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-32 border-2 border-dashed border-outline-variant/40 rounded-lg bg-surface-container-lowest/70">
                      <MoveDown className="w-8 h-8 text-primary/60 mb-2" />
                      <p className="text-xs font-extrabold uppercase tracking-wider text-on-surface-variant">Drop cards here</p>
                      <p className="text-[11px] text-on-surface-variant/70 mt-1">Nothing in this lane yet.</p>
                    </div>
                  )}
                  {displayedProjects.map(project => (
                    <div 
                      key={project.id}
                      draggable={isAdmin}
                      onDragStart={(e) => handleDragStart(e, project.id)}
                      onKeyDown={(e) => handleKeyboardDrag(e, project)}
                      onClick={() => onProjectClick(project.id)}
                      tabIndex={0}
                      role="button"
                      aria-grabbed={keyboardDraggedProjectId === project.id}
                      aria-describedby="kanban-keyboard-instructions"
                      className={`bg-surface-container-lowest p-4 rounded-md shadow-[0_2px_8px_rgba(0,0,0,0.02)] border-l-4 ${col.border} hover:shadow-md transition-shadow cursor-grab active:cursor-grabbing group`}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <span className="text-[10px] font-bold text-on-surface-variant bg-surface-container px-1.5 py-0.5 rounded">{project.code}</span>
                        <MoreHorizontal className="w-5 h-5 text-on-surface-variant opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                      <h4 className="font-bold text-sm mb-3 leading-snug">{project.title}</h4>
                      <div className="flex flex-wrap gap-2 mb-4">
                        {project.tags.map(tag => (
                          <span key={tag} className="bg-secondary-container text-on-secondary-fixed text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-tighter">{tag}</span>
                        ))}
                        <span className="bg-surface-container text-on-surface-variant text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-tighter">{project.priority} Priority</span>
                      </div>
                      
                      {project.progress > 0 && project.progress < 100 && (
                        <div className="w-full bg-surface-container h-1.5 rounded-full overflow-hidden mb-4">
                          <div className="bg-blue-600 h-full" style={{ width: `${project.progress}%` }}></div>
                        </div>
                      )}

                      <div className="flex justify-between items-center pt-3 border-t border-outline-variant/10">
                        <div className="flex items-center space-x-2">
                          {project.owner.avatar ? (
                            <img className="w-6 h-6 rounded-full object-cover" src={project.owner.avatar} alt={project.owner.name} />
                          ) : (
                            <div className="w-6 h-6 rounded-full bg-primary-fixed flex items-center justify-center text-[10px] font-bold text-primary">{project.owner.initials}</div>
                          )}
                          <span className="text-[10px] font-medium text-on-surface-variant">{project.owner.name}</span>
                        </div>
                        {project.status === 'Launched' && (
                          <div className="flex items-center space-x-1 text-tertiary-fixed-dim">
                            <CheckCircle2 className="w-4 h-4" />
                            <span className="text-[10px] font-bold">In Production</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
