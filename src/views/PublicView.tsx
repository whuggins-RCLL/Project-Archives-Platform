import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { Project } from '../types';
import { FolderArchive, ArrowRight, BarChart3, Clock, ShieldCheck } from 'lucide-react';
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

export default function PublicView({ embedded = false }: { embedded?: boolean }) {
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
    <div className="min-h-screen bg-surface font-body text-on-surface">
      {/* Header — hidden when embedded inside the signed-in app (Topbar shows context) */}
      {!embedded && (
        <header className="sticky top-0 z-10 border-b border-outline-variant/20 bg-surface-container-lowest/85 backdrop-blur">
          <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
            <div className="flex min-w-0 items-center gap-3">
              {branding.logoUrl ? (
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-outline-variant/30 bg-white shadow-sm">
                  <img src={branding.logoUrl} alt="" className="max-h-9 max-w-9 object-contain" />
                </div>
              ) : (
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary shadow-sm">
                  <FolderArchive className="h-5 w-5 text-white" aria-hidden />
                </div>
              )}
              <div className="min-w-0">
                <h1 className="truncate font-headline text-lg font-bold leading-tight text-brand-dark">{branding.portalName || APP_CONFIG.portalName}</h1>
                <p className="truncate text-xs text-on-surface-variant">{branding.suiteName || APP_CONFIG.appName} · {APP_CONFIG.subHeading}</p>
              </div>
            </div>
            <Link
              to="/login"
              className="inline-flex items-center gap-2 text-sm font-medium text-on-surface-variant transition-colors hover:text-primary"
            >
              Team login <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </header>
      )}

      {/* Hero Section */}
      <section className="relative isolate overflow-hidden bg-brand-dark text-white">
        {settings.heroMediaType === 'video' && settings.heroMediaUrl ? (
          <video
            className="absolute inset-0 -z-10 h-full w-full object-cover opacity-50"
            src={settings.heroMediaUrl}
            autoPlay
            muted
            loop
            playsInline
            disablePictureInPicture
            controls={false}
            controlsList="nodownload nofullscreen noremoteplayback"
            aria-hidden
          />
        ) : settings.heroMediaType === 'image' && settings.heroMediaUrl ? (
          <img
            className="absolute inset-0 -z-10 h-full w-full object-cover opacity-60"
            src={settings.heroMediaUrl}
            alt=""
            aria-hidden
          />
        ) : null}
        {settings.heroMediaUrl && settings.heroMediaType !== 'none' && (
          <div className="absolute inset-0 -z-10 bg-gradient-to-r from-brand-dark via-brand-dark/80 to-brand-dark/40" aria-hidden />
        )}
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-20">
          <div className="max-w-3xl">
            <h2 className="mb-6 font-headline text-4xl font-extrabold tracking-tight sm:text-5xl">
              {APP_CONFIG.heroTitle}
            </h2>
            <p className="mb-8 max-w-2xl text-lg leading-relaxed text-blue-100 sm:text-xl">
              {APP_CONFIG.heroSubtitle}
            </p>
            <div className="flex flex-wrap gap-4">
              <div className="flex items-center gap-4 rounded-xl border border-white/20 bg-white/10 p-4 backdrop-blur-sm">
                <div className="rounded-lg bg-blue-500/20 p-3">
                  <BarChart3 className="h-6 w-6 text-blue-300" />
                </div>
                <div>
                  <div className="text-2xl font-bold">{visibleProjects.length}</div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-blue-200">Active Initiatives</div>
                </div>
              </div>
              <div className="flex items-center gap-4 rounded-xl border border-white/20 bg-white/10 p-4 backdrop-blur-sm">
                <div className="rounded-lg bg-emerald-500/20 p-3">
                  <ShieldCheck className="h-6 w-6 text-emerald-300" />
                </div>
                <div>
                  <div className="text-2xl font-bold">{visibleProjects.filter(p => p.status === 'Launched').length}</div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-blue-200">Successfully Launched</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Projects Grid */}
      <main className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="mb-10">
          <h3 className="font-headline text-2xl font-bold text-on-surface">Current portfolio</h3>
          <p className="mt-2 text-on-surface-variant">An overview of our ongoing and completed AI transformation projects.</p>
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
          <div className="rounded-2xl border border-dashed border-outline-variant/40 bg-surface-container-lowest/70 px-6 py-16 text-center shadow-sm">
            <h4 className="font-headline text-xl font-bold text-on-surface">No projects match these filters</h4>
            <p className="mt-2 text-sm text-on-surface-variant">
              Try adjusting search terms, status, department, or reset filters to view more initiatives.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {visibleProjects.map(project => (
              <div key={project.id} className="flex flex-col overflow-hidden rounded-2xl border border-outline-variant/20 bg-surface-container-lowest shadow-sm transition-shadow hover:shadow-md">
                <div className="flex-1 p-6">
                  <div className="mb-4 flex items-start justify-between">
                    <span className="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                      {project.department}
                    </span>
                    <span className={`rounded-md px-2 py-1 text-xs font-bold ${
                      project.status === 'Launched' ? 'bg-tertiary-container/40 text-tertiary-fixed' :
                      project.status === 'In Progress' ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300' :
                      'bg-surface-container-high text-on-surface-variant'
                    }`}>
                      {project.status}
                    </span>
                  </div>
                  <h4 className="mb-2 text-lg font-bold text-on-surface">{project.title}</h4>
                  <p className="mb-6 line-clamp-3 text-sm text-on-surface-variant">{project.description}</p>

                  {project.progress > 0 && (
                    <div className="mt-auto">
                      <div className="mb-1.5 flex justify-between text-xs font-medium text-on-surface-variant">
                        <span>Progress</span>
                        <span>{project.progress}%</span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-surface-container-high">
                        <div
                          className={`h-full rounded-full ${project.progress === 100 ? 'bg-emerald-500' : 'bg-primary'}`}
                          style={{ width: `${project.progress}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between border-t border-outline-variant/15 bg-surface-container-low/50 px-6 py-4">
                  <div className="flex items-center gap-2">
                    {project.owner.avatar ? (
                      <img src={project.owner.avatar} alt={project.owner.name} className="h-6 w-6 rounded-full" />
                    ) : (
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-container-high text-[10px] font-bold text-on-surface-variant">
                        {project.owner.initials}
                      </div>
                    )}
                    <span className="text-xs font-medium text-on-surface-variant">{project.owner.name}</span>
                  </div>
                  <div className="flex items-center gap-1 text-on-surface-variant/80">
                    <Clock className="h-3.5 w-3.5" />
                    <span
                      className="text-[10px] font-bold uppercase tracking-wider"
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
      <footer className="mt-12 border-t border-outline-variant/20 bg-surface-container-lowest py-12">
        <div className="mx-auto max-w-7xl px-4 text-center sm:px-6 lg:px-8">
          <div className="mb-4 flex items-center justify-center space-x-2 opacity-60">
            <FolderArchive className="h-5 w-5 text-on-surface" />
            <span className="font-headline font-bold text-on-surface">{branding.portalName || APP_CONFIG.portalName}</span>
          </div>
          <p className="text-sm text-on-surface-variant">
            {settings.customFooter
              ? settings.customFooter
              : <>&copy; {new Date().getFullYear()} {APP_CONFIG.footerText}</>}
          </p>
          {settings.helpContactEmail && (
            <p className="mt-2 text-xs text-on-surface-variant/80">
              Need help? Contact <a href={`mailto:${settings.helpContactEmail}`} className="underline hover:text-on-surface">{settings.helpContactEmail}</a>
            </p>
          )}
        </div>
      </footer>
    </div>
  );
}
