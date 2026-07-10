import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { Project } from '../types';
import { FolderArchive, ArrowRight, BarChart3, Clock, ShieldCheck, ChevronDown, ChevronUp, Layers3, Heart, Sparkles, LogOut } from 'lucide-react';
import { Link } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { useAuthUser } from '../hooks/useAuthUser';
import { APP_CONFIG } from '../config';
import CommunityIntakeForm from '../components/CommunityIntakeForm';
import { getLikedProjectIds, persistLikedProjectIds } from '../lib/communityIntake';
import ProjectFilterBar, { DEFAULT_FILTER_QUERY } from '../components/ProjectFilterBar';
import { applyProjectFilters, getFilterOptions, ProjectFilterQuery } from '../lib/projectFilters';
import { useSavedViews } from '../hooks/useSavedViews';
import { useBranding } from '../hooks/useBranding';
import ThemeToggle from '../components/ThemeToggle';
import ArtifactLinkIcon from '../components/ArtifactLinkIcon';
import { getValidArtifactLinks, normalizeArtifactUrl } from '../lib/artifactLinks';

const DESCRIPTION_PREVIEW_LIMIT = 160;
const STATUS_GROUP_ORDER = ['In Progress', 'Planning', 'On Hold', 'Launched'] as const;

function getStatusGroupRank(status: string): number {
  const index = STATUS_GROUP_ORDER.indexOf(status as typeof STATUS_GROUP_ORDER[number]);
  return index === -1 ? STATUS_GROUP_ORDER.length : index;
}

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
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [likedIds, setLikedIds] = useState<Set<string>>(() => getLikedProjectIds());
  // Optimistic like counts: `base` is the server count at click time, so once the realtime
  // snapshot delivers a different server value the override is ignored automatically.
  const [likeOverrides, setLikeOverrides] = useState<Record<string, { base: number; next: number }>>({});
  const [likePendingIds, setLikePendingIds] = useState<Set<string>>(new Set());
  const { views, saveView, deleteView } = useSavedViews('public');
  const { branding, settings } = useBranding();
  const { user, isAuthReady } = useAuthUser();
  const isSignedIn = isAuthReady && Boolean(user);

  const handleSignOut = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Failed to sign out:', error);
    }
  };

  const displayLikeCount = (project: Project): number => {
    const serverCount = typeof project.likeCount === 'number' ? project.likeCount : 0;
    const override = likeOverrides[project.id];
    if (override && override.base === serverCount) return Math.max(0, override.next);
    return Math.max(0, serverCount);
  };

  const toggleLike = async (project: Project) => {
    if (likePendingIds.has(project.id)) return;
    const hasLiked = likedIds.has(project.id);
    const action = hasLiked ? 'unlike' : 'like';
    const serverCount = typeof project.likeCount === 'number' ? Math.max(0, project.likeCount) : 0;

    setLikePendingIds((prev) => new Set(prev).add(project.id));
    setLikeOverrides((prev) => ({
      ...prev,
      [project.id]: { base: serverCount, next: serverCount + (action === 'like' ? 1 : -1) },
    }));
    setLikedIds((prev) => {
      const next = new Set<string>(prev);
      if (action === 'like') next.add(project.id); else next.delete(project.id);
      persistLikedProjectIds(next);
      return next;
    });

    try {
      await api.togglePublicProjectLike(project.id, action);
    } catch (error) {
      console.error('Failed to update like:', error);
      // Roll back the optimistic update.
      setLikeOverrides((prev) => {
        const next = { ...prev };
        delete next[project.id];
        return next;
      });
      setLikedIds((prev) => {
        const next = new Set<string>(prev);
        if (action === 'like') next.delete(project.id); else next.add(project.id);
        persistLikedProjectIds(next);
        return next;
      });
    } finally {
      setLikePendingIds((prev) => {
        const next = new Set(prev);
        next.delete(project.id);
        return next;
      });
    }
  };

  const toggleExpanded = (projectId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  };

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
  const projectGroups = useMemo(() => {
    const grouped = visibleProjects.reduce<Record<string, Project[]>>((acc, project) => {
      const status = project.status || 'Uncategorized';
      if (!acc[status]) acc[status] = [];
      acc[status].push(project);
      return acc;
    }, {});

    return (Object.entries(grouped) as Array<[string, Project[]]>)
      .sort(([statusA], [statusB]) => {
        const rankDiff = getStatusGroupRank(statusA) - getStatusGroupRank(statusB);
        return rankDiff || statusA.localeCompare(statusB);
      })
      .map(([status, items]) => ({
        status,
        items: [...items].sort((a, b) => a.title.localeCompare(b.title)),
      }));
  }, [visibleProjects]);
  const filterOptions = useMemo(() => getFilterOptions(publicProjects), [publicProjects]);
  const heroQuickLinks = useMemo(
    () => (settings.heroQuickLinks ?? []).filter((link) => link.label.trim() && link.url.trim()),
    [settings.heroQuickLinks],
  );
  const publishedNarrative = (settings.heroNarrativePublished ?? '').trim();
  const isEmbedLayout = settings.publicLayout === 'embed';
  const showEmbedLogo = settings.embedShowLogo ?? true;

  return (
    <div className="min-h-screen app-canvas font-body">
      <a href="#main-content" className="skip-link">Skip to main content</a>
      {/* Header — hidden in embed layout, where the title and Team Login move into the hero */}
      {!isEmbedLayout && (
      <header className="glass-nav sticky top-0 z-30">
        <div className="content-shell h-16 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            {branding.logoUrl ? (
              <img
                src={branding.logoUrl}
                alt={branding.portalName || APP_CONFIG.portalName}
                className="shrink-0 h-10 w-auto max-w-[240px] object-contain object-left"
              />
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
            {isSignedIn ? (
              <>
                <Link
                  to="/app"
                  className="group inline-flex items-center gap-2 rounded-full border border-outline-variant/30 bg-surface-container-lowest/70 px-4 py-2 text-sm font-semibold text-brand-dark shadow-sm transition-all hover:border-primary/40 hover:shadow-md"
                >
                  Back to Dashboard <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                </Link>
                <button
                  type="button"
                  onClick={() => void handleSignOut()}
                  className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-semibold text-on-surface-variant transition-colors hover:bg-error/10 hover:text-error"
                  title="Sign out"
                >
                  <LogOut className="w-4 h-4" aria-hidden />
                  <span className="hidden sm:inline">Sign out</span>
                </button>
              </>
            ) : (
              <Link
                to="/login"
                className="group inline-flex items-center gap-2 rounded-full border border-outline-variant/30 bg-surface-container-lowest/70 px-4 py-2 text-sm font-semibold text-brand-dark shadow-sm transition-all hover:border-primary/40 hover:shadow-md"
              >
                Team Login <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </Link>
            )}
          </div>
        </div>
      </header>
      )}

      {/* Hero Section — in the standard layout it's pulled up behind the translucent nav so the image bleeds into it */}
      <div className={`relative isolate overflow-hidden text-white ${isEmbedLayout ? '' : '-mt-16'}`}>
        {branding.heroImageUrl ? (
          <>
            <img
              src={branding.heroImageUrl}
              alt=""
              aria-hidden
              className="absolute inset-0 -z-20 h-full w-full object-cover"
            />
            {/* Raw brand variables (not theme tokens) so the overlay — and the hero image under it — looks the same in dark mode. */}
            <div className="absolute inset-0 -z-10 bg-gradient-to-br from-(--brand-dark)/90 via-(--brand-dark)/75 to-(--brand-primary)/70" aria-hidden />
          </>
        ) : (
          <>
            <div className="brand-hero absolute inset-0 -z-20" aria-hidden />
            <div className="brand-hero-grid absolute inset-0 -z-10 opacity-70" aria-hidden />
          </>
        )}
        {/* Ambient glow accents */}
        <div className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-white/10 blur-3xl" aria-hidden />

        {/* Embed layout: brand identity and Team Login live inside the hero instead of a nav bar */}
        {isEmbedLayout && (
          <div className="content-shell pt-6 sm:pt-8 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              {showEmbedLogo && (
                branding.logoUrl ? (
                  <img
                    src={branding.logoUrl}
                    alt={branding.portalName || APP_CONFIG.portalName}
                    className="shrink-0 h-10 w-auto max-w-[240px] object-contain object-left"
                  />
                ) : (
                  <div className="shrink-0 flex h-11 w-11 items-center justify-center rounded-xl glass-on-dark">
                    <FolderArchive className="text-white w-5 h-5" aria-hidden />
                  </div>
                )
              )}
              <div className="min-w-0">
                <h1 className="font-headline text-lg font-bold text-white leading-tight truncate">{branding.portalName || APP_CONFIG.portalName}</h1>
                <p className="text-xs text-white/70 truncate">{branding.suiteName || APP_CONFIG.appName} · {APP_CONFIG.subHeading}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 sm:gap-3 shrink-0">
              <ThemeToggle tone="on-dark" />
              {isSignedIn ? (
                <>
                  <Link
                    to="/app"
                    className="group inline-flex items-center gap-2 rounded-full glass-on-dark px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md"
                  >
                    Back to Dashboard <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </Link>
                  <button
                    type="button"
                    onClick={() => void handleSignOut()}
                    className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-semibold text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                    title="Sign out"
                  >
                    <LogOut className="w-4 h-4" aria-hidden />
                    <span className="hidden sm:inline">Sign out</span>
                  </button>
                </>
              ) : (
                <Link
                  to="/login"
                  className="group inline-flex items-center gap-2 rounded-full glass-on-dark px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md"
                >
                  Team Login <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                </Link>
              )}
            </div>
          </div>
        )}

        <div className={`content-shell ${isEmbedLayout ? 'pt-10 pb-16 sm:pt-12 sm:pb-20' : 'pt-28 pb-20 sm:pt-32 sm:pb-24 lg:pt-36 lg:pb-28'}`}>
          <div className="max-w-3xl xl:max-w-4xl animate-fade-in-up">
            <h2 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold font-headline tracking-tight mb-6 leading-[1.05]">
              {APP_CONFIG.heroTitle}
            </h2>
            <p className="text-lg sm:text-xl text-white/80 mb-8 max-w-2xl leading-relaxed">
              {APP_CONFIG.heroSubtitle}
            </p>
            {publishedNarrative && (
              <div className="glass-on-dark glass-sheen mb-8 rounded-2xl p-5 leading-relaxed text-white/90 shadow-xl">
                <p className="text-base sm:text-lg whitespace-pre-line">{publishedNarrative}</p>
              </div>
            )}
            <div className="mb-8 flex flex-wrap gap-3">
                <a
                  href="#suggest-a-project"
                  className="group inline-flex items-center gap-2 rounded-full glass-on-dark px-6 py-2.5 text-sm font-semibold text-white shadow-lg transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  <Sparkles className="w-4 h-4 text-amber-300" aria-hidden />
                  Suggest a project
                </a>
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
            <div className="flex flex-wrap gap-4">
              <div className="glass-on-dark glass-sheen rounded-2xl p-4 flex items-center gap-4 shadow-lg">
                <div className="p-3 bg-white/15 rounded-xl">
                  <BarChart3 className="w-6 h-6 text-white" aria-hidden />
                </div>
                <div>
                  <div className="text-2xl font-bold font-headline">{visibleProjects.filter(p => p.status !== 'Launched').length}</div>
                  <div className="text-xs text-white/70 uppercase tracking-wider font-semibold">In Development</div>
                </div>
              </div>
              <div className="glass-on-dark glass-sheen rounded-2xl p-4 flex items-center gap-4 shadow-lg">
                <div className="p-3 bg-emerald-400/20 rounded-xl">
                  <ShieldCheck className="w-6 h-6 text-emerald-200" aria-hidden />
                </div>
                <div>
                  <div className="text-2xl font-bold font-headline">{visibleProjects.filter(p => p.status === 'Launched').length}</div>
                  <div className="text-xs text-white/70 uppercase tracking-wider font-semibold">Live Now</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Projects Grid */}
      <main id="main-content" tabIndex={-1} className="content-shell py-16 focus:outline-none" aria-labelledby="portfolio-heading">
        <div className="mb-10 max-w-3xl">
          <span className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-primary">
            <Layers3 className="h-3.5 w-3.5" aria-hidden />
            Organized by stage
          </span>
          <h2 id="portfolio-heading" className="text-2xl sm:text-3xl font-bold text-brand-dark font-headline tracking-tight">Current Portfolio</h2>
          <p className="text-on-surface-variant mt-2">
            Browse public initiatives grouped by delivery stage, then narrow the list with search, department, status, and saved views as the portfolio grows.
          </p>
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
          <div className="space-y-14">
            {projectGroups.map((group) => (
              <section key={group.status} aria-labelledby={`status-${group.status.replace(/\s+/g, '-').toLowerCase()}`}>
                <div className="mb-6 flex items-center gap-3">
                  <span className="h-7 w-1.5 rounded-full bg-gradient-to-b from-primary to-brand-dark" aria-hidden />
                  <h3 id={`status-${group.status.replace(/\s+/g, '-').toLowerCase()}`} className="font-headline text-xl font-extrabold text-brand-dark">{group.status}</h3>
                  <span className="rounded-full border border-primary/15 bg-primary/10 px-2.5 py-0.5 text-xs font-bold text-primary">
                    {group.items.length} {group.items.length === 1 ? 'project' : 'projects'}
                  </span>
                  <span className="hidden sm:block h-px flex-1 bg-gradient-to-r from-outline-variant/40 to-transparent" aria-hidden />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6">
                  {group.items.map((project, index) => {
              const isExpanded = expandedIds.has(project.id);
              const description = project.description ?? '';
              const canExpand = description.length > DESCRIPTION_PREVIEW_LIMIT;
              const artifactLinks = getValidArtifactLinks(project.artifactLinks);
              return (
              <div
                key={project.id}
                className="public-project-card glass-card glass-sheen lift overflow-hidden flex flex-col animate-fade-in-up"
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
                  <p className={`text-sm text-on-surface-variant whitespace-pre-line ${isExpanded ? '' : 'line-clamp-3'} ${canExpand ? 'mb-1.5' : 'mb-6'}`}>
                    {description}
                  </p>
                  {canExpand && (
                    <button
                      type="button"
                      onClick={() => toggleExpanded(project.id)}
                      aria-expanded={isExpanded}
                      className="mb-6 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded"
                    >
                      {isExpanded ? (
                        <>Show less <ChevronUp className="w-3.5 h-3.5" aria-hidden /></>
                      ) : (
                        <>Read more <ChevronDown className="w-3.5 h-3.5" aria-hidden /></>
                      )}
                    </button>
                  )}

                  {artifactLinks.length > 0 && (
                    <div className="mb-6 flex flex-wrap gap-2">
                      {artifactLinks.map((link) => (
                        <a
                          key={link.id}
                          href={normalizeArtifactUrl(link.url)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-full border border-outline-variant/30 bg-surface-container-lowest/70 px-3 py-1 text-xs font-semibold text-brand-dark shadow-sm transition-all hover:border-primary/40 hover:text-primary hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                        >
                          <ArtifactLinkIcon type={link.type} className="w-3.5 h-3.5" />
                          {link.label}
                        </a>
                      ))}
                    </div>
                  )}

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
                <div className="px-6 py-4 border-t border-outline-variant/15 flex items-center justify-between">
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
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => toggleLike(project)}
                      disabled={likePendingIds.has(project.id)}
                      aria-pressed={likedIds.has(project.id)}
                      aria-label={likedIds.has(project.id) ? `Unlike ${project.title}` : `Like ${project.title}`}
                      title={likedIds.has(project.id) ? 'You like this project' : 'Like this project'}
                      className={`group/like inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold shadow-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-wait ${
                        likedIds.has(project.id)
                          ? 'border-rose-300/60 bg-rose-50 text-rose-600'
                          : 'border-outline-variant/30 bg-surface-container-lowest/70 text-on-surface-variant hover:border-rose-300/60 hover:text-rose-500'
                      }`}
                    >
                      <Heart
                        className={`w-3.5 h-3.5 transition-transform group-hover/like:scale-110 ${likedIds.has(project.id) ? 'fill-current' : ''}`}
                        aria-hidden
                      />
                      {displayLikeCount(project)}
                    </button>
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
              </div>
              );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}

        {/* Community project suggestions */}
        <section id="suggest-a-project" className="mt-20 scroll-mt-24" aria-labelledby="suggest-a-project-heading">
          <div className="mb-8 max-w-3xl">
            <span className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-primary">
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              For the SLS community
            </span>
            <h2 id="suggest-a-project-heading" className="text-2xl sm:text-3xl font-bold text-brand-dark font-headline tracking-tight">
              Suggest a project
            </h2>
            <p className="text-on-surface-variant mt-2">
              Share an idea with our team in about a minute. Every suggestion lands on our project board for review —
              submitting one doesn&rsquo;t guarantee it will be built, but it helps shape what we work on next.
            </p>
          </div>
          <CommunityIntakeForm />
        </section>
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
