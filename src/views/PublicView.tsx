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
import ThemeToggle from '../components/ThemeToggle';

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

  const publicProjects = useMemo(() => projects.filter((project) => project.isPublic !== false), [projects]);
  const visibleProjects = useMemo(() => applyProjectFilters(publicProjects, filterQuery), [publicProjects, filterQuery]);
  const filterOptions = useMemo(() => getFilterOptions(publicProjects), [publicProjects]);
  const heroQuickLinks = useMemo(
    () => (settings.heroQuickLinks ?? []).filter((link) => link.label.trim() && link.url.trim()),
    [settings.heroQuickLinks],
  );
  const publishedNarrative = (settings.heroNarrativePublished ?? '').trim();

  return (
    <div className="min-h-screen app-canvas font-body">
      <a href="#main-content" className="skip-link">Skip to main content</a>
      {/* Header */}
      <header className="glass-nav sticky top-0 z-20">
        <div className="content-shell h-16 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            {branding.logoUrl ? (
              <div className="shrink-0 flex h-11 w-11 items-center justify-center rounded-xl border border-outline-variant/20 bg-white shadow-sm">
                <img src={branding.logoUrl} alt="" className="max-h-9 max-w-9 object-contain" />
              </div>
            ) : (
              <div className="shrink-0 flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-brand-dark shadow-md">
                <FolderArchive className="text-white w-5 h-5" aria-hidden />
              </div>
            )}
            <div className="min-w-0">
              <h1 className="font-headline text-lg font-bold text-brand-dark leading-tight truncate">{branding.portalName || APP_CONFIG.portalName}</h1>
              <p className="text-xs text-on-surface-variant truncate">{branding.suiteName || APP_CONFIG.appName} · {APP_CONFIG.subHeading}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <ThemeToggle />
            <Link
              to="/login"
              className="group inline-flex items-center gap-2 rounded-full border border-outline-variant/30 bg-surface-container-lowest/70 px-4 py-2 text-sm font-semibold text-brand-dark shadow-sm transition-all hover:border-primary/40 hover:shadow-md"
            >
              Team Login <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <div className="relative isolate overflow-hidden text-white">
        {branding.heroImageUrl ? (
          <>
            <img
              src={branding.heroImageUrl}
              alt=""
              aria-hidden
              className="absolute inset-0 -z-20 h-full w-full object-cover"
            />
            <div className="absolute inset-0 -z-10 bg-gradient-to-br from-brand-dark/90 via-brand-dark/75 to-primary/70" aria-hidden />
          </>
        ) : (
          <>
            <div className="brand-hero absolute inset-0 -z-20" aria-hidden />
            <div className="brand-hero-grid absolute inset-0 -z-10 opacity-70" aria-hidden />
          </>
        )}
        {/* Ambient glow accents */}
        <div className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-white/10 blur-3xl" aria-hidden />

        <div className="content-shell py-20 sm:py-24 lg:py-28">
          <div className="max-w-3xl xl:max-w-4xl animate-fade-in-up">
            <span className="mb-6 inline-flex items-center gap-2 rounded-full glass-on-dark px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-white/90">
              <Sparkles className="w-3.5 h-3.5" aria-hidden /> {branding.suiteName || APP_CONFIG.appName}
            </span>
            <h2 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold font-headline tracking-tight mb-6 leading-[1.05]">
              {APP_CONFIG.heroTitle}
            </h2>
            <p className="text-lg sm:text-xl text-white/80 mb-8 max-w-2xl leading-relaxed">
              {APP_CONFIG.heroSubtitle}
            </p>
            {publishedNarrative && (
              <div className="glass-on-dark glass-sheen mb-8 rounded-2xl p-5 leading-relaxed text-white/90 shadow-xl">
                <div className="mb-2 inline-flex items-center gap-2 text-xs uppercase tracking-[0.16em] font-semibold text-white/70"><Sparkles className="w-4 h-4" aria-hidden /> Project Story</div>
                <p className="text-base sm:text-lg whitespace-pre-line">{publishedNarrative}</p>
              </div>
            )}
            {heroQuickLinks.length > 0 && (
              <div className="mb-8 flex flex-wrap gap-3">
                {heroQuickLinks.map((link) => (
                  <a
                    key={link.id}
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                    className="group inline-flex items-center gap-2 rounded-full bg-white px-6 py-2.5 text-sm font-semibold text-brand-dark shadow-lg shadow-black/25 ring-1 ring-white/40 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  >
                    {link.label}
                    <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </a>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-4">
              <div className="glass-on-dark glass-sheen rounded-2xl p-4 flex items-center gap-4 shadow-lg">
                <div className="p-3 bg-white/15 rounded-xl">
                  <BarChart3 className="w-6 h-6 text-white" aria-hidden />
                </div>
                <div>
                  <div className="text-2xl font-bold font-headline">{visibleProjects.length}</div>
                  <div className="text-xs text-white/70 uppercase tracking-wider font-semibold">Active Initiatives</div>
                </div>
              </div>
              <div className="glass-on-dark glass-sheen rounded-2xl p-4 flex items-center gap-4 shadow-lg">
                <div className="p-3 bg-emerald-400/20 rounded-xl">
                  <ShieldCheck className="w-6 h-6 text-emerald-200" aria-hidden />
                </div>
                <div>
                  <div className="text-2xl font-bold font-headline">{visibleProjects.filter(p => p.status === 'Launched').length}</div>
                  <div className="text-xs text-white/70 uppercase tracking-wider font-semibold">Successfully Launched</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Projects Grid */}
      <main id="main-content" tabIndex={-1} className="content-shell py-16 focus:outline-none" aria-labelledby="portfolio-heading">
        <div className="mb-10">
          <h2 id="portfolio-heading" className="text-2xl font-bold text-brand-dark font-headline tracking-tight">Current Portfolio</h2>
          <p className="text-on-surface-variant mt-2">An overview of our ongoing and completed AI transformation projects.</p>
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
          <div className="flex justify-center py-20" role="status" aria-live="polite">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" aria-hidden></div>
            <span className="sr-only">Loading projects…</span>
          </div>
        ) : visibleProjects.length === 0 ? (
          <div className="glass-card px-6 py-16 text-center" role="status">
            <h3 className="text-xl font-headline font-bold text-brand-dark">No projects match these filters</h3>
            <p className="mt-2 text-sm text-on-surface-variant">
              Try adjusting search terms, status, department, or reset filters to view more initiatives.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-6">
            {visibleProjects.map((project, index) => (
              <div
                key={project.id}
                className="glass-card lift overflow-hidden flex flex-col animate-fade-in-up"
                style={{ animationDelay: `${Math.min(index * 60, 480)}ms` }}
              >
                <div className="p-6 flex-1">
                  <div className="flex justify-between items-start mb-4">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-primary/10 text-primary border border-primary/15">
                      {project.department}
                    </span>
                    <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                      project.status === 'Launched' ? 'bg-emerald-100 text-emerald-800' :
                      project.status === 'In Progress' ? 'bg-amber-100 text-amber-800' :
                      'bg-surface-container-high text-on-surface-variant'
                    }`}>
                      {project.status}
                    </span>
                  </div>
                  <h3 className="text-lg font-bold text-brand-dark mb-2 font-headline leading-snug">{project.title}</h3>
                  <p className="text-sm text-on-surface-variant line-clamp-3 mb-6">{project.description}</p>

                  {project.progress > 0 && (
                    <div className="mt-auto">
                      <div className="flex justify-between text-xs font-medium text-on-surface-variant mb-1.5">
                        <span>Progress</span>
                        <span className="font-bold text-brand-dark">{project.progress}%</span>
                      </div>
                      <div
                        className="w-full bg-surface-container-high h-2 rounded-full overflow-hidden"
                        role="progressbar"
                        aria-valuenow={project.progress}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`${project.title} progress: ${project.progress}%`}
                      >
                        <div
                          className={`h-full rounded-full transition-all ${project.progress === 100 ? 'bg-emerald-500' : 'bg-gradient-to-r from-primary to-brand-dark'}`}
                          style={{ width: `${project.progress}%` }}
                        ></div>
                      </div>
                    </div>
                  )}
                </div>
                <div className="bg-surface-container-low/60 px-6 py-4 border-t border-outline-variant/15 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {project.owner.avatar ? (
                      <img src={project.owner.avatar} alt={project.owner.name} className="w-6 h-6 rounded-full object-cover" />
                    ) : (
                      <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary">
                        {project.owner.initials}
                      </div>
                    )}
                    <span className="text-xs font-medium text-on-surface-variant">{project.owner.name}</span>
                  </div>
                  <div className="flex items-center gap-1 text-on-surface-variant/70">
                    <Clock className="w-3.5 h-3.5" aria-hidden />
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
      <footer className="glass-nav border-t border-outline-variant/20 py-12 mt-12">
        <div className="content-shell text-center">
          <div className="flex items-center justify-center space-x-2 mb-4 opacity-60">
            <FolderArchive className="w-5 h-5 text-brand-dark" aria-hidden />
            <span className="font-headline font-bold text-brand-dark">{branding.portalName || APP_CONFIG.portalName}</span>
          </div>
          <p className="text-sm text-on-surface-variant">
            {settings.customFooter
              ? settings.customFooter
              : <>&copy; {new Date().getFullYear()} {APP_CONFIG.footerText}</>}
          </p>
          {settings.helpContactEmail && (
            <p className="text-xs text-on-surface-variant/70 mt-2">
              Need help? Contact <a href={`mailto:${settings.helpContactEmail}`} className="underline hover:text-primary">{settings.helpContactEmail}</a>
            </p>
          )}
        </div>
      </footer>
    </div>
  );
}
