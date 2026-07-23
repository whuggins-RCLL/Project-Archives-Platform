import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, Search, X, GitMerge } from 'lucide-react';
import { api } from '../lib/api';
import { Project } from '../types';

type MergeProjectsModalProps = {
  sourceProject: Project;
  allProjects: Project[];
  onClose: () => void;
  onMerged: (message: string) => void;
};

const dedupeCount = (
  primary: Array<Record<string, unknown>> | undefined,
  secondary: Array<Record<string, unknown>> | undefined,
  keyOf: (item: Record<string, unknown>) => string,
): number => {
  const seen = new Set<string>();
  for (const item of [...(primary ?? []), ...(secondary ?? [])]) {
    if (!item || typeof item !== 'object') continue;
    const key = keyOf(item);
    seen.add(key || JSON.stringify(item));
  }
  return seen.size;
};

const mergedTags = (primary: Project, secondary: Project): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of [...(primary.tags ?? []), ...(secondary.tags ?? [])]) {
    const key = tag.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= 20) break;
  }
  return out;
};

export default function MergeProjectsModal({ sourceProject, allProjects, onClose, onMerged }: MergeProjectsModalProps) {
  const [partnerId, setPartnerId] = useState<string | null>(null);
  const [sourceIsPrimary, setSourceIsPrimary] = useState(true);
  const [search, setSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, submitting]);

  const candidates = useMemo(() => {
    const query = search.trim().toLowerCase();
    return allProjects
      .filter((project) => project.id !== sourceProject.id)
      .filter((project) => !query || project.title.toLowerCase().includes(query) || project.code.toLowerCase().includes(query))
      .slice(0, 50);
  }, [allProjects, sourceProject.id, search]);

  const partner = useMemo(() => allProjects.find((project) => project.id === partnerId) ?? null, [allProjects, partnerId]);

  const primary = sourceIsPrimary ? sourceProject : partner;
  const secondary = sourceIsPrimary ? partner : sourceProject;

  const handleMerge = async () => {
    if (!primary || !secondary) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await api.mergeProjects(primary.id, secondary.id);
      onMerged(result.message);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to merge projects.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" role="presentation" onClick={() => !submitting && onClose()}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="merge-modal-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-outline-variant/20 bg-surface-container-lowest shadow-2xl"
      >
        <div className="flex items-start justify-between border-b border-outline-variant/20 px-6 py-4">
          <div>
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
              <GitMerge className="h-4 w-4" aria-hidden /> Merge project cards
            </p>
            <h2 id="merge-modal-title" className="mt-1 text-xl font-bold text-on-surface">
              Merge into “{sourceProject.title}”
            </h2>
          </div>
          <button onClick={() => !submitting && onClose()} aria-label="Close merge dialog" className="rounded-lg p-1 text-on-surface-variant hover:bg-surface-container-high">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 px-6 py-5">
          {/* Step 1: choose the other card */}
          <div>
            <label className="text-sm font-bold text-on-surface" htmlFor="merge-partner-search">1. Choose the card to merge with</label>
            <div className="mt-2 flex items-center gap-2 rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-2">
              <Search className="h-4 w-4 text-on-surface-variant" aria-hidden />
              <input
                id="merge-partner-search"
                className="flex-1 bg-transparent text-sm outline-none"
                placeholder="Search by name or code"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-outline-variant/20">
              {candidates.length === 0 && <p className="p-3 text-sm text-on-surface-variant">No other projects match.</p>}
              {candidates.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => setPartnerId(project.id)}
                  className={`flex w-full items-center justify-between gap-2 border-b border-outline-variant/10 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-surface-container-high ${partnerId === project.id ? 'bg-primary/10' : ''}`}
                  aria-pressed={partnerId === project.id}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-on-surface">{project.title}</span>
                    <span className="block truncate text-xs text-on-surface-variant">{project.code} · {project.status}</span>
                  </span>
                  {partnerId === project.id && <span className="shrink-0 text-xs font-bold text-primary">Selected</span>}
                </button>
              ))}
            </div>
          </div>

          {/* Step 2: choose survivor + preview */}
          {partner && primary && secondary && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-on-surface">2. Which card survives?</p>
                  <p className="text-xs text-on-surface-variant">Its title, description, status and other single-value details are kept.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSourceIsPrimary((current) => !current)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-outline-variant/40 px-3 py-1.5 text-xs font-semibold text-on-surface hover:bg-surface-container-high"
                >
                  <ArrowLeftRight className="h-4 w-4" aria-hidden /> Swap
                </button>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-lg border-2 border-primary bg-primary/5 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-primary">Survivor (kept)</p>
                  <p className="mt-1 truncate font-bold text-on-surface" title={primary.title}>{primary.title}</p>
                  <p className="truncate text-xs text-on-surface-variant">{primary.code} · {primary.status}</p>
                </div>
                <div className="rounded-lg border border-error/40 bg-error/5 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-error">Merged in, then deleted</p>
                  <p className="mt-1 truncate font-bold text-on-surface" title={secondary.title}>{secondary.title}</p>
                  <p className="truncate text-xs text-on-surface-variant">{secondary.code} · {secondary.status}</p>
                </div>
              </div>

              <div className="rounded-lg border border-outline-variant/20 bg-surface-container-low p-3 text-sm">
                <p className="mb-2 font-bold text-on-surface">Combined result</p>
                <ul className="space-y-1 text-xs text-on-surface-variant">
                  <li><strong className="text-on-surface">Tags:</strong> {mergedTags(primary, secondary).join(', ') || 'none'}</li>
                  <li><strong className="text-on-surface">Collaborators:</strong> {dedupeCount(primary.collaborators as Array<Record<string, unknown>>, secondary.collaborators as Array<Record<string, unknown>>, (c) => String(c.uid || c.name || '').toLowerCase())}</li>
                  <li><strong className="text-on-surface">Artifact links:</strong> {dedupeCount(primary.artifactLinks as Array<Record<string, unknown>>, secondary.artifactLinks as Array<Record<string, unknown>>, (l) => String(l.url || l.id || '').toLowerCase())}</li>
                  <li><strong className="text-on-surface">Milestones:</strong> {(primary.milestones?.length ?? 0) + (secondary.milestones?.length ?? 0)} · <strong className="text-on-surface">Dependencies:</strong> {(primary.dependencies?.length ?? 0) + (secondary.dependencies?.length ?? 0)} · <strong className="text-on-surface">Checkpoints:</strong> {(primary.approvalCheckpoints?.length ?? 0) + (secondary.approvalCheckpoints?.length ?? 0)}</li>
                  <li><strong className="text-on-surface">Public likes:</strong> {(primary.likeCount ?? 0) + (secondary.likeCount ?? 0)}</li>
                </ul>
                <p className="mt-2 text-xs text-on-surface-variant">Comments and planning notes from both cards are combined. This cannot be undone.</p>
              </div>
            </div>
          )}

          {error && <div role="alert" className="rounded-lg border border-error/40 bg-error/10 p-3 text-sm text-error">{error}</div>}
        </div>

        <div className="flex justify-end gap-2 border-t border-outline-variant/20 px-6 py-4">
          <button onClick={() => !submitting && onClose()} className="rounded-lg px-4 py-2 text-sm font-semibold text-on-surface-variant hover:bg-surface-container-high">
            Cancel
          </button>
          <button
            onClick={() => void handleMerge()}
            disabled={!partner || submitting}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <GitMerge className="h-4 w-4" aria-hidden />
            {submitting ? 'Merging…' : 'Merge cards'}
          </button>
        </div>
      </div>
    </div>
  );
}
