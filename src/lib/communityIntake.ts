/**
 * Public "Suggest a project" intake form configuration.
 * Keep COMMUNITY_SUGGESTION_CATEGORIES in sync with PUBLIC_SUGGESTION_CATEGORIES in server.ts —
 * the server rejects submissions whose category is not in its own list.
 */
export const COMMUNITY_SUGGESTION_CATEGORIES = [
  'AI Learning Hub Suggestions',
  'AI Upload Suggestions',
  'New Guides',
  'Coding Help',
  'Research & Data Tools',
  'Workflow Automation',
  'Trainings & Workshops',
  'Other',
] as const;

export type CommunitySuggestionCategory = typeof COMMUNITY_SUGGESTION_CATEGORIES[number];

export interface CommunitySuggestionPayload {
  name: string;
  email: string;
  projectName: string;
  category: string;
  description: string;
  goal: string;
  audience?: string;
}

export const COMMUNITY_SUGGESTION_LIMITS = {
  name: 100,
  email: 254,
  projectName: 100,
  description: 4000,
  goal: 1000,
  audience: 300,
} as const;

const LIKED_PROJECTS_STORAGE_KEY = 'pa_public_liked_projects';

/** Project ids this browser has liked (best-effort; used to toggle like/unlike locally). */
export function getLikedProjectIds(): Set<string> {
  try {
    const raw = window.localStorage.getItem(LIKED_PROJECTS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

export function persistLikedProjectIds(ids: Set<string>): void {
  try {
    window.localStorage.setItem(LIKED_PROJECTS_STORAGE_KEY, JSON.stringify(Array.from(ids).slice(0, 500)));
  } catch {
    // Storage unavailable (private mode, embed sandbox) — likes still count server-side.
  }
}
