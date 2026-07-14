import { Project, ProjectPriority, ProjectStatus } from '../types';

export type DueDateBucket = 'all' | 'overdue' | 'this_week' | 'next_30' | 'no_due_date';

export interface ProjectFilterQuery {
  searchTerm: string;
  departments: string[];
  riskFactors: string[];
  priorities: ProjectPriority[];
  statuses: ProjectStatus[];
  owners: string[];
  ownerGroups: string[];
  tagsAll: string[];
  tagsAny: string[];
  dueDateBucket: DueDateBucket;
}

export const DEFAULT_FILTER_QUERY: ProjectFilterQuery = {
  searchTerm: '',
  departments: [],
  riskFactors: [],
  priorities: [],
  statuses: [],
  owners: [],
  ownerGroups: [],
  tagsAll: [],
  tagsAny: [],
  dueDateBucket: 'all'
};

const DAY_MS = 24 * 60 * 60 * 1000;

function getProjectDueDate(project: Project): Date | null {
  if (!project.dueDate) return null;
  const dueDate = new Date(project.dueDate);
  return Number.isNaN(dueDate.getTime()) ? null : dueDate;
}

function matchesDueDate(project: Project, bucket: DueDateBucket, now = new Date()): boolean {
  if (bucket === 'all') return true;

  const dueDate = getProjectDueDate(project);
  if (!dueDate) {
    return bucket === 'no_due_date';
  }

  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  if (bucket === 'overdue') {
    return dueDate < startOfToday;
  }

  if (bucket === 'this_week') {
    const endOfWeek = new Date(startOfToday.getTime() + 7 * DAY_MS);
    return dueDate >= startOfToday && dueDate < endOfWeek;
  }

  if (bucket === 'next_30') {
    const inThirtyDays = new Date(startOfToday.getTime() + 30 * DAY_MS);
    return dueDate >= startOfToday && dueDate <= inThirtyDays;
  }

  return false;
}

function includesAll(list: string[], selected: string[]): boolean {
  if (!selected.length) return true;
  const normalized = list.map(i => i.toLowerCase());
  return selected.every(item => normalized.includes(item.toLowerCase()));
}

function includesAny(list: string[], selected: string[]): boolean {
  if (!selected.length) return true;
  const normalized = list.map(i => i.toLowerCase());
  return selected.some(item => normalized.includes(item.toLowerCase()));
}

export type ProjectSearchScope = 'team' | 'public';

function getProjectSearchText(project: Project, scope: ProjectSearchScope): string {
  const ownerGroup = project.owner.group || project.owner.name;

  if (scope === 'public') {
    return [
      project.owner.name,
      project.status,
      project.title,
      project.description,
    ].join(' ').toLowerCase();
  }

  return [
    project.title,
    project.code,
    project.description,
    project.department,
    project.owner.name,
    ownerGroup,
    project.status,
    project.priority,
    ...project.tags,
  ].join(' ').toLowerCase();
}

export function applyProjectFilters(projects: Project[], query: ProjectFilterQuery, searchScope: ProjectSearchScope = 'team'): Project[] {
  return projects.filter((project) => {
    const ownerGroup = project.owner.group || project.owner.name;
    const normalizedSearch = query.searchTerm.trim().toLowerCase();

    if (normalizedSearch.length > 0) {
      if (!getProjectSearchText(project, searchScope).includes(normalizedSearch)) return false;
    }

    if (query.departments.length > 0 && !query.departments.includes(project.department)) return false;
    if (query.riskFactors.length > 0 && !query.riskFactors.includes(project.riskFactor)) return false;
    if (query.priorities.length > 0 && !query.priorities.includes(project.priority)) return false;
    if (query.statuses.length > 0 && !query.statuses.includes(project.status)) return false;
    if (query.owners.length > 0 && !query.owners.includes(project.owner.name)) return false;
    if (query.ownerGroups.length > 0 && !query.ownerGroups.includes(ownerGroup)) return false;
    if (!includesAll(project.tags, query.tagsAll)) return false;
    if (!includesAny(project.tags, query.tagsAny)) return false;
    if (!matchesDueDate(project, query.dueDateBucket)) return false;

    return true;
  });
}

export function getFilterOptions(projects: Project[]) {
  const departments = Array.from(new Set(projects.map(p => p.department))).sort();
  const riskFactors = Array.from(new Set(projects.map(p => p.riskFactor))).sort();
  const owners = Array.from(new Set(projects.map(p => p.owner.name))).sort();
  const ownerGroups = Array.from(new Set(projects.map(p => p.owner.group || p.owner.name))).sort();
  const tags = Array.from(new Set(projects.flatMap(p => p.tags))).sort();
  const priorities = Array.from(new Set(projects.map(p => p.priority))).sort();
  const statuses = Array.from(new Set(projects.map(p => p.status))).sort();

  return { departments, riskFactors, owners, ownerGroups, tags, priorities, statuses };
}
