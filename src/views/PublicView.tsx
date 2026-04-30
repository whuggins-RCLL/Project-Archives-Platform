import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { Project } from '../types';
import { FolderArchive, ArrowRight, BarChart3, Clock, ShieldCheck, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { APP_CONFIG } from '../config';
import ProjectFilterBar, { DEFAULT_FILTER_QUERY } from '../components/ProjectFilterBar';
import { applyProjectFilters, getFilterOptions, ProjectFilterQuery } from '../lib/projectFilters';
import { useSavedViews } from '../hooks/useSavedViews';
import { useBranding } from '../hooks/useBranding';

type TimestampLike =
  | string
  | number
  | Date
  | { toDate?: () => Date; seconds?: number; nanoseconds?: number }
  | null
  | undefined;

function toDate(value: TimestampLike): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === 'object') {
    if (typeof value.toDate === 'function') {
      const parsed = value.toDate();
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    if (typeof value.seconds === 'number') {
      const parsed = new Date((value.seconds * 1000) + ((value.nanoseconds || 0) / 1e6));
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
  }
  return null;
}

function formatLastUpdated(project: Project): string {
  const sourceDate = toDate(project.updatedAt) ?? toDate(project.createdAt);
  if (!sourceDate) return 'Last updated date unavailable';

  const diffMs = Date.now() - sourceDate.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  if (diffMinutes < 1) return 'Last updated just now';
  if (diffMinutes < 60) return `Last updated ${diffMinutes}m ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `Last updated ${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `Last updated ${diffDays}d ago`;

  return `Last updated ${sourceDate.toLocaleDateString()}`;
}

export default function PublicView() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterQuery, setFilterQuery] = useState<ProjectFilterQuery>(DEFAULT_FILTER_QUERY);
  const { views, saveView, deleteView } = useSavedViews('public');
  const { branding, settings } = useBranding();

  useEffect(() => {
    const unsubscribe = api.subscribeToProjects(
      (data) => {
        setProjects(data);
        setLoading(false);
      },
      (error) => {
        console.error("Failed to subscribe to projects:", error);
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, []);

  const visibleProjects = useMemo(() => applyProjectFilters(projects, filterQuery), [projects, filterQuery]);
  const filterOptions = useMemo(() => getFilterOptions(projects), [projects]);

  return (
    <div className="min-h-screen bg-slate-50 font-body">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            {branding.logoUrl ? (
              <div className="shrink-0 flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200/80 bg-white shadow-sm">
                <img src={branding.logoUrl} alt="" className="max-h-9 max-w-9 object-contain" />
              </div>
            ) : (
              <div className="shrink-0 flex h-11 w-11 items-center justify-center rounded-lg bg-primary shadow-sm">
                <FolderArchive className="text-white w-5 h-5" aria-hidden />
              </div>
            )}
            <div className="min-w-0">
              <h1 className="font-headline text-lg font-bold text-brand-dark leading-tight truncate">{branding.portalName || APP_CONFIG.portalName}</h1>
              <p className="text-xs text-slate-500 truncate">{branding.suiteName || APP_CONFIG.appName} · {APP_CONFIG.subHeading}</p>
            </div>
          </div>
          <Link 
            to="/login"
            className="text-sm font-medium text-slate-600 hover:text-primary transition-colors flex items-center gap-2"
          >
            Team Login <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </header>

      {/* Hero Section */}
      <div className="bg-brand-dark text-white py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <h2 className="text-4xl sm:text-5xl font-extrabold font-headline tracking-tight mb-6">
              {APP_CONFIG.heroTitle}
            </h2>
            <p className="text-lg sm:text-xl text-blue-100 mb-8 max-w-2xl leading-relaxed">
              {APP_CONFIG.heroSubtitle}
            </p>
            {settings.heroNarrativePublished && (
              <div className="mb-8 rounded-xl border border-white/20 bg-white/10 p-5 text-blue-50 leading-relaxed">
                <div className="mb-2 inline-flex items-center gap-2 text-xs uppercase tracking-[0.16em] font-semibold text-blue-200"><Sparkles className="w-4 h-4" /> Project Story</div>
                <p className="text-base sm:text-lg">{settings.heroNarrativePublished}</p>
              </div>
            )}
            {settings.heroQuickLinks && settings.heroQuickLinks.length > 0 && (
              <div className="mb-8 flex flex-wrap gap-3">
                {settings.heroQuickLinks.map((link) => (
                  <a key={link.id} href={link.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full border border-white/35 bg-white px-5 py-2.5 text-sm font-semibold text-brand-dark shadow-sm transition hover:-translate-y-0.5 hover:bg-blue-50">
                    {link.label} <ArrowRight className="w-4 h-4" />
                  </a>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-4">
              <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4 flex items-center gap-4 border border-white/20">
                <div className="p-3 bg-blue-500/20 rounded-lg">
                  <BarChart3 className="w-6 h-6 text-blue-300" />
                </div>
                <div>
                  <div className="text-2xl font-bold">{visibleProjects.length}</div>
                  <div className="text-xs text-blue-200 uppercase tracking-wider font-semibold">Active Initiatives</div>
                </div>
              </div>
              <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4 flex items-center gap-4 border border-white/20">
                <div className="p-3 bg-emerald-500/20 rounded-lg">
                  <ShieldCheck className="w-6 h-6 text-emerald-300" />
                </div>
                <div>
                  <div className="text-2xl font-bold">{visibleProjects.filter(p => p.status === 'Launched').length}</div>
                  <div className="text-xs text-blue-200 uppercase tracking-wider font-semibold">Successfully Launched</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Projects Grid */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="mb-10">
          <h3 className="text-2xl font-bold text-slate-900 font-headline">Current Portfolio</h3>
          <p className="text-slate-600 mt-2">An overview of our ongoing and completed AI transformation projects.</p>
        </div>

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

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
          </div>
        ) : visibleProjects.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 px-6 py-16 text-center shadow-sm">
            <h4 className="text-xl font-headline font-bold text-slate-900">No projects match these filters</h4>
            <p className="mt-2 text-sm text-slate-600">
              Try adjusting search terms, status, department, or reset filters to view more initiatives.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {visibleProjects.map(project => (
              <div key={project.id} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden hover:shadow-md transition-shadow flex flex-col">
                <div className="p-6 flex-1">
                  <div className="flex justify-between items-start mb-4">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-100">
                      {project.department}
                    </span>
                    <span className={`text-xs font-bold px-2 py-1 rounded-md ${
                      project.status === 'Launched' ? 'bg-emerald-100 text-emerald-800' :
                      project.status === 'In Progress' ? 'bg-amber-100 text-amber-800' :
                      'bg-slate-100 text-slate-800'
                    }`}>
                      {project.status}
                    </span>
                  </div>
                  <h4 className="text-lg font-bold text-slate-900 mb-2">{project.title}</h4>
                  <p className="text-sm text-slate-600 line-clamp-3 mb-6">{project.description}</p>
                  
                  {project.progress > 0 && (
                    <div className="mt-auto">
                      <div className="flex justify-between text-xs font-medium text-slate-500 mb-1.5">
                        <span>Progress</span>
                        <span>{project.progress}%</span>
                      </div>
                      <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                        <div 
                          className={`h-full rounded-full ${project.progress === 100 ? 'bg-emerald-500' : 'bg-primary'}`} 
                          style={{ width: `${project.progress}%` }}
                        ></div>
                      </div>
                    </div>
                  )}
                </div>
                <div className="bg-slate-50 px-6 py-4 border-t border-slate-100 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {project.owner.avatar ? (
                      <img src={project.owner.avatar} alt={project.owner.name} className="w-6 h-6 rounded-full" />
                    ) : (
                      <div className="w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center text-[10px] font-bold text-slate-600">
                        {project.owner.initials}
                      </div>
                    )}
                    <span className="text-xs font-medium text-slate-600">{project.owner.name}</span>
                  </div>
                  <div className="flex items-center gap-1 text-slate-400">
                    <Clock className="w-3.5 h-3.5" />
                    <span
                      className="text-[10px] uppercase font-bold tracking-wider"
                      title={(toDate(project.updatedAt) ?? toDate(project.createdAt))?.toLocaleString() || 'Unknown update time'}
                    >
                      {formatLastUpdated(project)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
      
      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-12 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="flex items-center justify-center space-x-2 mb-4 opacity-50">
            <FolderArchive className="w-5 h-5 text-slate-900" />
            <span className="font-headline font-bold text-slate-900">{branding.portalName || APP_CONFIG.portalName}</span>
          </div>
          <p className="text-sm text-slate-500">
            {settings.customFooter
              ? settings.customFooter
              : <>&copy; {new Date().getFullYear()} {APP_CONFIG.footerText}</>}
          </p>
          {settings.helpContactEmail && (
            <p className="text-xs text-slate-400 mt-2">
              Need help? Contact <a href={`mailto:${settings.helpContactEmail}`} className="underline hover:text-slate-600">{settings.helpContactEmail}</a>
            </p>
          )}
        </div>
      </footer>
    </div>
  );
}
