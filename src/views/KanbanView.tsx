import { ChevronDown, ChevronRight, Filter, Users, Plus, MoreHorizontal, CheckCircle2, MoveDown, Minimize2, Maximize2, Globe, Lock, Sparkles, Heart, GitMerge } from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { Project, ProjectStatus } from '../types';
import ProjectFilterBar, { DEFAULT_FILTER_QUERY } from '../components/ProjectFilterBar';
import { applyProjectFilters, getFilterOptions, ProjectFilterQuery } from '../lib/projectFilters';
import { useSavedViews } from '../hooks/useSavedViews';
import Button from '../components/Button';
import MergeProjectsModal from '../components/MergeProjectsModal';

const COLUMNS: { title: ProjectStatus; color: string; border: string }[] = [
  { title: 'Intake / Proposed', color: 'bg-on-surface-variant/40', border: 'border-slate-300' },
  { title: 'Scoping', color: 'bg-primary/40', border: 'border-primary-fixed' },
  { title: 'In Progress', color: 'bg-blue-500 animate-pulse', border: 'border-blue-600' },
  { title: 'Pilot / Testing', color: 'bg-amber-500', border: 'border-amber-500' },
  { title: 'Review / Approval', color: 'bg-purple-500', border: 'border-purple-500' },
  { title: 'Launched', color: 'bg-tertiary-fixed', border: 'border-tertiary-fixed-dim' }
];

const LATE_STAGE_STATUSES: ProjectStatus[] = ['Review / Approval', 'Launched'];
const LATE_STAGE_STATUS_SET = new Set<ProjectStatus>(LATE_STAGE_STATUSES);

const STATUS_ALIASES: Record<string, ProjectStatus> = {
  intake: 'Intake / Proposed',
  proposed: 'Intake / Proposed',
  'intake / proposed': 'Intake / Proposed',
  'intake/proposed': 'Intake / Proposed',
  scoping: 'Scoping',
  active: 'In Progress',
  'in progress': 'In Progress',
  'in-progress': 'In Progress',
  execution: 'In Progress',
  'pilot / testing': 'Pilot / Testing',
  'pilot/testing': 'Pilot / Testing',
  pilot: 'Pilot / Testing',
  testing: 'Pilot / Testing',
  'review / approval': 'Review / Approval',
  'review/approval': 'Review / Approval',
  review: 'Review / Approval',
  approval: 'Review / Approval',
  launched: 'Launched',
  complete: 'Launched',
  completed: 'Launched',
  done: 'Launched',
};

const normalizeProjectStatus = (status: string | undefined): ProjectStatus => {
  if (!status) return 'Intake / Proposed';
  const normalized = STATUS_ALIASES[status.trim().toLowerCase()];
  return normalized ?? 'Intake / Proposed';
};

export default function KanbanView({ projects, loading, onProjectClick, onNewProject, isAdmin }: { projects: Project[], loading: boolean, onProjectClick: (id: string) => void, onNewProject: () => void, isAdmin: boolean }) {
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [filterQuery, setFilterQuery] = useState<ProjectFilterQuery>(DEFAULT_FILTER_QUERY);
  const [keyboardDraggedProjectId, setKeyboardDraggedProjectId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ type: 'error'; text: string } | null>(null);
  const [isCompactBoard, setIsCompactBoard] = useState(true);
  const [collapsedColumns, setCollapsedColumns] = useState<Set<ProjectStatus>>(new Set());
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [mergeSource, setMergeSource] = useState<Project | null>(null);
  const [mergeNotice, setMergeNotice] = useState<string | null>(null);
  const { views, saveView, deleteView } = useSavedViews('kanban');
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!statusMessage) return;
    const timeout = window.setTimeout(() => setStatusMessage(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [statusMessage]);

  useEffect(() => {
    if (!mergeNotice) return;
    const timeout = window.setTimeout(() => setMergeNotice(null), 4000);
    return () => window.clearTimeout(timeout);
  }, [mergeNotice]);

  useEffect(() => {
    if (!openMenuId) return;
    const onDocClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpenMenuId(null);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [openMenuId]);

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
    if (e.key === 'Enter') {
      e.preventDefault();
      if (keyboardDraggedProjectId === project.id) {
        setKeyboardDraggedProjectId(null);
      } else {
        onProjectClick(project.id);
      }
      return;
    }

    if (!isAdmin) {
      if (e.key === ' ') {
        e.preventDefault();
        onProjectClick(project.id);
      }
      return;
    }

    if (e.key === ' ') {
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

    const projectStatus = normalizeProjectStatus(project.status);
    const columnIndex = COLUMNS.findIndex((column) => column.title === projectStatus);
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

  const toggleColumnCollapse = (status: ProjectStatus) => {
    setCollapsedColumns((current) => {
      const next = new Set(current);
      if (next.has(status)) {
        next.delete(status);
      } else {
        next.add(status);
      }
      return next;
    });
  };

  const filteredProjects = useMemo(() => applyProjectFilters(projects, filterQuery), [projects, filterQuery]);
  const filterOptions = useMemo(() => getFilterOptions(projects), [projects]);
  const lateStageProjectCount = useMemo(
    () => filteredProjects.filter((project) => LATE_STAGE_STATUS_SET.has(normalizeProjectStatus(project.status))).length,
    [filteredProjects]
  );

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

  const renderProjectCard = (project: Project, col: { title: ProjectStatus; color: string; border: string }) => {
    const isLaunched = normalizeProjectStatus(project.status) === 'Launched';
    const compactRevealClasses = isCompactBoard
      ? 'max-h-0 overflow-hidden opacity-0 transition-all duration-200 group-hover:max-h-28 group-hover:opacity-100 group-focus:max-h-28 group-focus:opacity-100'
      : '';
    const compactDetailFooterClasses = isCompactBoard
      ? 'max-h-0 overflow-hidden opacity-0 transition-all duration-200 group-hover:max-h-16 group-hover:border-t group-hover:pt-3 group-hover:opacity-100 group-focus:max-h-16 group-focus:border-t group-focus:pt-3 group-focus:opacity-100'
      : 'border-t pt-3';

    return (
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
        className={`bg-surface-container-lowest ${isCompactBoard ? 'p-3' : 'p-4'} rounded-md shadow-[0_2px_8px_rgba(0,0,0,0.02)] border-l-4 ${col.border} hover:shadow-md transition-shadow cursor-grab active:cursor-grabbing group`}
      >
        <div className={`flex justify-between items-start ${isCompactBoard ? 'mb-1.5' : 'mb-2'}`}>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-bold text-on-surface-variant bg-surface-container px-1.5 py-0.5 rounded">{project.code}</span>
            <span className="bg-surface-container text-on-surface-variant text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-tighter">{project.priority}</span>
            <span
              className={`inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-tighter ${project.isPublic === false ? 'bg-surface-container text-on-surface-variant' : 'bg-tertiary-container text-on-tertiary-container'}`}
              title={project.isPublic === false ? 'Private — hidden from the public dashboard' : 'Public — shown on the public dashboard'}
            >
              {project.isPublic === false ? <Lock className="w-2.5 h-2.5" aria-hidden /> : <Globe className="w-2.5 h-2.5" aria-hidden />}
              {project.isPublic === false ? 'Private' : 'Public'}
            </span>
            {project.source === 'community' && (
              <span
                className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-tighter bg-violet-100 text-violet-800"
                title="Suggested by the SLS community through the public intake form"
              >
                <Sparkles className="w-2.5 h-2.5" aria-hidden />
                SLS Community
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {typeof project.likeCount === 'number' && project.likeCount > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-rose-500" title={`${project.likeCount} public ${project.likeCount === 1 ? 'like' : 'likes'}`} aria-label={`${project.likeCount} public ${project.likeCount === 1 ? 'like' : 'likes'}`}>
                <Heart className="w-3 h-3 fill-current" aria-hidden />
                {project.likeCount}
              </span>
            )}
            {isLaunched && <CheckCircle2 className="w-4 h-4 text-tertiary-fixed-dim" role="img" aria-label="In production" />}
            {isAdmin && (
              <div className="relative" ref={openMenuId === project.id ? menuRef : undefined}>
                <button
                  type="button"
                  aria-label={`Card actions for ${project.title}`}
                  aria-haspopup="menu"
                  aria-expanded={openMenuId === project.id}
                  onClick={(e) => { e.stopPropagation(); setOpenMenuId((current) => current === project.id ? null : project.id); }}
                  className="rounded p-0.5 text-on-surface-variant opacity-0 group-hover:opacity-100 group-focus:opacity-100 focus:opacity-100 transition-opacity hover:bg-surface-container-high focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                  <MoreHorizontal className="w-5 h-5" aria-hidden />
                </button>
                {openMenuId === project.id && (
                  <div role="menu" className="absolute right-0 z-20 mt-1 w-44 rounded-lg border border-outline-variant/30 bg-surface-container-lowest py-1 shadow-lg">
                    <button
                      type="button"
                      role="menuitem"
                      disabled={projects.length < 2}
                      onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); setMergeSource(project); }}
                      title={projects.length < 2 ? 'Need another project to merge with' : 'Merge this card with another'}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-on-surface hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <GitMerge className="h-4 w-4" aria-hidden /> Merge with…
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        <h4 className={`font-bold ${isCompactBoard ? 'text-[13px] mb-2' : 'text-sm mb-3'} leading-snug`}>{project.title}</h4>

        <div className={`${compactRevealClasses} ${isCompactBoard ? 'group-hover:mb-2 group-focus:mb-2' : 'mb-4'}`}>
          <div className={`flex flex-wrap ${isCompactBoard ? 'gap-1.5' : 'gap-2'}`}>
            {project.tags.map(tag => (
              <span key={tag} className="bg-secondary-container text-on-secondary-fixed text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-tighter">{tag}</span>
            ))}
            {!isCompactBoard && (
              <span className="bg-surface-container text-on-surface-variant text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-tighter">{project.priority} Priority</span>
            )}
          </div>
        </div>

        {project.progress > 0 && project.progress < 100 && (
          <div className={`w-full bg-surface-container ${isCompactBoard ? 'h-1 mb-2' : 'h-1.5 mb-4'} rounded-full overflow-hidden`}>
            <div className="bg-blue-600 h-full" style={{ width: `${project.progress}%` }}></div>
          </div>
        )}

        <div className={`${compactDetailFooterClasses} border-outline-variant/10`}>
          <div className="flex justify-between items-center">
            <div className="flex items-center space-x-2">
              {project.owner.avatar ? (
                <img className="w-6 h-6 rounded-full object-cover" src={project.owner.avatar} alt={project.owner.name} />
              ) : (
                <div className="w-6 h-6 rounded-full bg-primary-fixed flex items-center justify-center text-[10px] font-bold text-on-primary-fixed">{project.owner.initials}</div>
              )}
              <span className="text-[10px] font-medium text-on-surface-variant">{project.owner.name}</span>
            </div>
            {isLaunched && (
              <div className="flex items-center space-x-1 text-tertiary-fixed-dim">
                <CheckCircle2 className="w-4 h-4" aria-hidden />
                <span className="text-[10px] font-bold">In Production</span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderColumn = (col: { title: ProjectStatus; color: string; border: string }) => {
    const colProjects = filteredProjects.filter(p => normalizeProjectStatus(p.status) === col.title);
    const displayedProjects = getFilteredProjects(colProjects);
    const isCollapsed = collapsedColumns.has(col.title);
    const columnWidthClass = isCollapsed ? (isCompactBoard ? 'w-14' : 'w-16') : (isCompactBoard ? 'w-64' : 'w-80');

    if (isCollapsed) {
      return (
        <div
          key={col.title}
          className={`${columnWidthClass} flex flex-col h-full bg-surface-container-low rounded-xl p-2`}
          onDragOver={handleDragOver}
          onDrop={(e) => handleDrop(e, col.title)}
        >
          <button
            type="button"
            onClick={() => toggleColumnCollapse(col.title)}
            aria-expanded={false}
            className="flex h-full w-full flex-col items-center justify-between rounded-lg px-1.5 py-3 text-on-surface-variant hover:bg-surface-container-high focus:outline-none focus:ring-2 focus:ring-primary/40"
            title={`Expand ${col.title}`}
          >
            <span className={`w-2.5 h-2.5 rounded-full ${col.color}`}></span>
            <span className="sr-only">Expand {col.title}</span>
            <span className="[writing-mode:vertical-rl] rotate-180 text-[11px] font-bold uppercase tracking-wide">{col.title}</span>
            <span className="text-xs font-bold bg-surface-container-high px-1.5 py-0.5 rounded">{colProjects.length}</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      );
    }

    return (
      <div
        key={col.title}
        className={`${columnWidthClass} flex flex-col h-full bg-surface-container-low rounded-xl p-3`}
        onDragOver={handleDragOver}
        onDrop={(e) => handleDrop(e, col.title)}
      >
        <div className="flex items-center justify-between mb-4 px-2">
          <div className="flex items-center space-x-2">
            <span className={`w-2 h-2 rounded-full ${col.color}`}></span>
            <h3 className="font-bold text-sm text-on-surface-variant tracking-wide uppercase">{col.title}</h3>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-bold text-on-surface-variant bg-surface-container-high px-2 py-0.5 rounded">{colProjects.length}</span>
            <button
              type="button"
              onClick={() => toggleColumnCollapse(col.title)}
              aria-expanded={true}
              className="rounded-md p-1 text-on-surface-variant hover:bg-surface-container-high focus:outline-none focus:ring-2 focus:ring-primary/40"
              title={`Collapse ${col.title}`}
            >
              <span className="sr-only">Collapse {col.title}</span>
              <ChevronDown className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className={`${isCompactBoard ? 'space-y-2' : 'space-y-3'} overflow-y-auto pr-1 kanban-scroll flex-1`}>
          {displayedProjects.length === 0 && (
            <div className="flex flex-col items-center justify-center h-32 border-2 border-dashed border-outline-variant/40 rounded-lg bg-surface-container-lowest/70">
              <MoveDown className="w-8 h-8 text-primary/60 mb-2" aria-hidden />
              <p className="text-xs font-extrabold uppercase tracking-wider text-on-surface-variant">Drop cards here</p>
              <p className="text-[11px] text-on-surface-variant/70 mt-1">Nothing in this lane yet.</p>
            </div>
          )}
          {displayedProjects.map(project => renderProjectCard(project, col))}
        </div>
      </div>
    );
  };

  return (
    <div className="p-10 min-h-screen flex flex-col relative">
      {statusMessage && (
        <div className="fixed top-6 right-6 z-50">
          <div role="alert" className="px-4 py-3 rounded-lg shadow-lg border text-sm font-bold bg-error-container text-error border-error/30">
            {statusMessage.text}
          </div>
        </div>
      )}
      {mergeNotice && (
        <div className="fixed top-6 right-6 z-50">
          <div role="status" aria-live="polite" className="px-4 py-3 rounded-lg shadow-lg border text-sm font-bold bg-tertiary-container text-on-tertiary-container border-tertiary-fixed-dim/30">
            {mergeNotice}
          </div>
        </div>
      )}
      {mergeSource && (
        <MergeProjectsModal
          sourceProject={mergeSource}
          allProjects={projects}
          onClose={() => setMergeSource(null)}
          onMerged={(message) => setMergeNotice(message)}
        />
      )}
      <header className="mb-8 flex flex-col space-y-6">
        <div className="flex justify-between items-end">
          <div>
            <h1 className="font-headline text-3xl font-extrabold tracking-tight text-on-surface">Global Project Board</h1>
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
            <Button
              onClick={() => setIsCompactBoard((current) => !current)}
              variant={isCompactBoard ? 'primary' : 'secondary'}
              aria-pressed={isCompactBoard}
              title={isCompactBoard ? 'Switch to full card details' : 'Switch to compact cards'}
            >
              {isCompactBoard ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
              <span>{isCompactBoard ? 'Compact board' : 'Full board'}</span>
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
          Press Enter to open a project. Press Space to pick up or drop a card. While a card is picked up, use the arrow keys to move it between columns, and press Escape to cancel.
        </p>
        <div className={`flex h-full min-w-max ${isCompactBoard ? 'space-x-3' : 'space-x-6'}`}>
          {COLUMNS.filter(col => !LATE_STAGE_STATUS_SET.has(col.title)).map(renderColumn)}
          <section
            className={`flex h-full flex-col ${isCompactBoard ? 'rounded-2xl border border-outline-variant/30 bg-surface-container-lowest/70 p-2' : ''}`}
            aria-label="Review and launch stages"
          >
            {isCompactBoard && (
              <div className="mb-2 flex items-center justify-between px-2 text-[11px] font-bold uppercase tracking-wide text-on-surface-variant">
                <span>Review + launch</span>
                <span className="rounded-full bg-surface-container-high px-2 py-0.5">{lateStageProjectCount}</span>
              </div>
            )}
            <div className={`flex flex-1 ${isCompactBoard ? 'space-x-3' : 'space-x-6'}`}>
              {COLUMNS.filter(col => LATE_STAGE_STATUS_SET.has(col.title)).map(renderColumn)}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
