import { ProjectArtifactLink, ProjectArtifactLinkType } from '../types';

export const ARTIFACT_LINK_TYPE_OPTIONS: Array<{ value: ProjectArtifactLinkType; label: string }> = [
  { value: 'github', label: 'GitHub / Repository' },
  { value: 'demo', label: 'Live Demo' },
  { value: 'docs', label: 'Documentation' },
  { value: 'design', label: 'Design' },
  { value: 'dataset', label: 'Dataset' },
  { value: 'other', label: 'Other Link' },
];

const TYPE_LABELS: Record<ProjectArtifactLinkType, string> = {
  github: 'Repository',
  demo: 'Live Demo',
  docs: 'Docs',
  design: 'Design',
  dataset: 'Dataset',
  other: 'Link',
};

export function getArtifactTypeLabel(type: ProjectArtifactLinkType | undefined): string {
  return TYPE_LABELS[type ?? 'other'] ?? TYPE_LABELS.other;
}

/** Ensures a user-entered URL has an http(s) scheme so anchors resolve as absolute links. */
export function normalizeArtifactUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/** Best-effort guess of the artifact type from the URL host so admins get a sensible default. */
export function detectArtifactType(url: string): ProjectArtifactLinkType {
  const value = url.toLowerCase();
  if (/github\.com|gitlab\.com|bitbucket\.org/.test(value)) return 'github';
  if (/figma\.com|dribbble\.com|behance\.net/.test(value)) return 'design';
  if (/kaggle\.com|huggingface\.co\/datasets|data\.world/.test(value)) return 'dataset';
  if (/docs\.|notion\.so|readme\.|confluence|gitbook/.test(value)) return 'docs';
  if (/vercel\.app|netlify\.app|herokuapp\.com|\.io\b|demo/.test(value)) return 'demo';
  return 'other';
}

/** Returns only artifact links that have both a label and a resolvable URL. */
export function getValidArtifactLinks(links: ProjectArtifactLink[] | undefined): ProjectArtifactLink[] {
  return (links ?? []).filter((link) => link.label.trim() && link.url.trim());
}
