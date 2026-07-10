import { Filter, Save, Search, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { DEFAULT_FILTER_QUERY, DueDateBucket, ProjectFilterQuery } from '../lib/projectFilters';
import { SavedView } from '../hooks/useSavedViews';
import Button from './Button';

interface FilterOptions {
  departments: string[];
  riskFactors: string[];
  owners: string[];
  ownerGroups: string[];
  tags: string[];
  priorities?: string[];
  statuses?: string[];
}

function MultiSelect({ id, label, values, options, onChange }: { id: string; label: string; values: string[]; options: string[]; onChange: (v: string[]) => void }) {
  const selectedCount = values.length;

  const toggleOption = (option: string) => {
    if (values.includes(option)) {
      onChange(values.filter(value => value !== option));
      return;
    }

    onChange([...values, option]);
  };

  return (
    <details className="flex flex-col gap-1 text-xs font-semibold text-on-surface-variant min-w-[180px] relative">
      <summary
        id={id}
        className="bg-surface-container-low border border-outline-variant/30 rounded-md px-3 py-2 text-xs cursor-pointer list-none flex items-center justify-between gap-2"
      >
        <span>{label}</span>
        <span className="text-on-surface-variant/80 font-normal">
          {selectedCount > 0 ? `${selectedCount} selected` : 'Any'}
        </span>
      </summary>

      <div className="absolute top-full left-0 z-20 mt-1 w-64 max-h-56 overflow-auto bg-surface-container-low border border-outline-variant/30 rounded-md p-2 shadow-lg">
        {options.map(option => {
          const checked = values.includes(option);
          return (
            <label key={option} className="flex items-center gap-2 px-1 py-1 text-xs font-normal cursor-pointer">
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggleOption(option)}
                className="h-3 w-3"
              />
              <span>{option}</span>
            </label>
          );
        })}
        {options.length === 0 ? (
          <p className="px-1 py-1 text-xs font-normal text-on-surface-variant/80">No options available.</p>
        ) : null}
      </div>
    </details>
  );
}

export default function ProjectFilterBar({
  query,
  onChange,
  onReset,
  options,
  savedViews,
  onSaveView,
  onApplySavedView,
  onDeleteSavedView,
}: {
  query: ProjectFilterQuery;
  onChange: (query: ProjectFilterQuery) => void;
  onReset: () => void;
  options: FilterOptions;
  savedViews: SavedView[];
  onSaveView: (name: string) => void;
  onApplySavedView: (viewId: string) => void;
  onDeleteSavedView: (viewId: string) => void;
}) {
  const [newViewName, setNewViewName] = useState('');
  const [selectedViewId, setSelectedViewId] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);

  const dueDateOptions: { value: DueDateBucket; label: string }[] = useMemo(() => [
    { value: 'all', label: 'All' },
    { value: 'overdue', label: 'Overdue' },
    { value: 'this_week', label: 'Due This Week' },
    { value: 'next_30', label: 'Due in Next 30 Days' },
    { value: 'no_due_date', label: 'No Due Date' }
  ], []);

  const dueDateLabel = dueDateOptions.find(option => option.value === query.dueDateBucket)?.label ?? 'All';
  const activeFilterChips = useMemo(() => {
    const chips: Array<{ key: string; label: string; onRemove: () => void }> = [];

    if (query.searchTerm.trim()) {
      chips.push({
        key: 'search',
        label: `Search: ${query.searchTerm.trim()}`,
        onRemove: () => onChange({ ...query, searchTerm: '' }),
      });
    }

    query.priorities.forEach(priority => chips.push({
      key: `priority-${priority}`,
      label: `Priority: ${priority}`,
      onRemove: () => onChange({ ...query, priorities: query.priorities.filter(value => value !== priority) }),
    }));
    query.statuses.forEach(status => chips.push({
      key: `status-${status}`,
      label: `Status: ${status}`,
      onRemove: () => onChange({ ...query, statuses: query.statuses.filter(value => value !== status) }),
    }));
    query.departments.forEach(department => chips.push({
      key: `department-${department}`,
      label: `Department: ${department}`,
      onRemove: () => onChange({ ...query, departments: query.departments.filter(value => value !== department) }),
    }));
    query.riskFactors.forEach(risk => chips.push({
      key: `risk-${risk}`,
      label: `Risk: ${risk}`,
      onRemove: () => onChange({ ...query, riskFactors: query.riskFactors.filter(value => value !== risk) }),
    }));
    query.owners.forEach(owner => chips.push({
      key: `owner-${owner}`,
      label: `Owner: ${owner}`,
      onRemove: () => onChange({ ...query, owners: query.owners.filter(value => value !== owner) }),
    }));
    query.ownerGroups.forEach(group => chips.push({
      key: `owner-group-${group}`,
      label: `Group: ${group}`,
      onRemove: () => onChange({ ...query, ownerGroups: query.ownerGroups.filter(value => value !== group) }),
    }));
    query.tagsAll.forEach(tag => chips.push({
      key: `tag-all-${tag}`,
      label: `Tag all: ${tag}`,
      onRemove: () => onChange({ ...query, tagsAll: query.tagsAll.filter(value => value !== tag) }),
    }));
    query.tagsAny.forEach(tag => chips.push({
      key: `tag-any-${tag}`,
      label: `Tag any: ${tag}`,
      onRemove: () => onChange({ ...query, tagsAny: query.tagsAny.filter(value => value !== tag) }),
    }));

    if (query.dueDateBucket !== 'all') {
      chips.push({
        key: 'due-date',
        label: `Due: ${dueDateLabel}`,
        onRemove: () => onChange({ ...query, dueDateBucket: 'all' }),
      });
    }

    return chips;
  }, [dueDateLabel, onChange, query]);

  const activeFilterCount = activeFilterChips.length;

  return (
    <section className="glass-card glass-sheen p-3 sm:p-4 mb-8">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <label htmlFor="project-filter-search" className="relative flex-1">
          <span className="sr-only">Search projects</span>
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-variant/60" aria-hidden />
          <input
            id="project-filter-search"
            type="search"
            value={query.searchTerm}
            onChange={(event) => onChange({ ...query, searchTerm: event.target.value })}
            placeholder="Search title, code, owner, department, tags..."
            className="w-full rounded-full border border-outline-variant/25 bg-surface-container-lowest/60 pl-11 pr-4 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/60 outline-none transition-all focus:border-primary/40 focus:ring-2 focus:ring-primary/25"
          />
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={filtersOpen ? 'primary' : 'outline'}
            size="sm"
            onClick={() => setFiltersOpen((open) => !open)}
            aria-expanded={filtersOpen}
            aria-controls="project-filter-advanced"
          >
            <Filter className="w-3.5 h-3.5" />
            <span>{filtersOpen ? 'Hide filters' : 'Filters'}</span>
            {activeFilterCount > 0 && (
              <span className="rounded-full bg-primary-container/20 px-2 py-0.5 text-[10px] font-bold text-current">
                {activeFilterCount}
              </span>
            )}
          </Button>
          {activeFilterCount > 0 && (
            <Button variant="outline" size="sm" onClick={onReset}>Clear all</Button>
          )}
        </div>
      </div>

      {activeFilterChips.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {activeFilterChips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={chip.onRemove}
              className="inline-flex items-center gap-1 rounded-full border border-outline-variant/30 bg-surface-container-lowest/60 px-3 py-1 text-xs font-semibold text-on-surface-variant hover:border-primary/40 hover:text-brand-dark"
              title={`Remove ${chip.label}`}
            >
              <span>{chip.label}</span>
              <X className="h-3 w-3" aria-hidden />
            </button>
          ))}
        </div>
      )}

      {filtersOpen && (
        <div id="project-filter-advanced" className="mt-4 rounded-2xl border border-outline-variant/20 bg-surface-container-low/60 p-4">
          <div className="flex flex-wrap gap-3 items-end">
            <MultiSelect id="project-filter-priority" label="Priority" values={query.priorities} options={options.priorities || ['High', 'Medium', 'Low']} onChange={(v) => onChange({ ...query, priorities: v as ProjectFilterQuery['priorities'] })} />
            <MultiSelect id="project-filter-status" label="Status" values={query.statuses} options={options.statuses || ['Intake / Proposed', 'Scoping', 'In Progress', 'Pilot / Testing', 'Review / Approval', 'Launched']} onChange={(v) => onChange({ ...query, statuses: v as ProjectFilterQuery['statuses'] })} />
            <MultiSelect id="project-filter-department" label="Department" values={query.departments} options={options.departments} onChange={(v) => onChange({ ...query, departments: v })} />
            <MultiSelect id="project-filter-risk" label="Risk" values={query.riskFactors} options={options.riskFactors} onChange={(v) => onChange({ ...query, riskFactors: v })} />
            <MultiSelect id="project-filter-owners" label="Owners" values={query.owners} options={options.owners} onChange={(v) => onChange({ ...query, owners: v })} />
            <MultiSelect id="project-filter-owner-groups" label="Owner Groups" values={query.ownerGroups} options={options.ownerGroups} onChange={(v) => onChange({ ...query, ownerGroups: v })} />
            <MultiSelect id="project-filter-tags-all" label="Tags (All)" values={query.tagsAll} options={options.tags} onChange={(v) => onChange({ ...query, tagsAll: v })} />
            <MultiSelect id="project-filter-tags-any" label="Tags (Any)" values={query.tagsAny} options={options.tags} onChange={(v) => onChange({ ...query, tagsAny: v })} />

            <label htmlFor="project-filter-due-date" className="flex flex-col gap-1 text-xs font-semibold text-on-surface-variant min-w-[160px]">
              Due Date
              <select
                id="project-filter-due-date"
                value={query.dueDateBucket}
                onChange={(event) => onChange({ ...query, dueDateBucket: event.target.value as DueDateBucket })}
                className="bg-surface-container-lowest border border-outline-variant/30 rounded-md p-2 text-xs"
              >
                {dueDateOptions.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-4 pt-4 border-t border-outline-variant/20 flex flex-wrap gap-2 items-center">
            <label htmlFor="project-filter-save-view" className="sr-only">Save current view name</label>
            <input
              id="project-filter-save-view"
              value={newViewName}
              onChange={(e) => setNewViewName(e.target.value)}
              placeholder="Save current view as..."
              className="bg-surface-container-lowest border border-outline-variant/30 rounded-md px-3 py-2 text-xs min-w-[220px]"
            />
            <Button
              onClick={() => {
                onSaveView(newViewName);
                setNewViewName('');
              }}
              variant="primary"
              size="sm"
            >
              <Save className="w-3 h-3" /> Save View
            </Button>

            <label htmlFor="project-filter-load-view" className="sr-only">Load saved view</label>
            <select
              id="project-filter-load-view"
              value={selectedViewId}
              onChange={(e) => {
                const id = e.target.value;
                setSelectedViewId(id);
                if (id) onApplySavedView(id);
              }}
              className="bg-surface-container-lowest border border-outline-variant/30 rounded-md px-3 py-2 text-xs min-w-[200px]"
            >
              <option value="">Load saved view...</option>
              {savedViews.map(view => (
                <option key={view.id} value={view.id}>{view.name}</option>
              ))}
            </select>

            <Button
              onClick={() => selectedViewId && onDeleteSavedView(selectedViewId)}
              disabled={!selectedViewId}
              variant="outline"
              size="sm"
            >
              <Trash2 className="w-3 h-3" /> Delete
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

export { DEFAULT_FILTER_QUERY };
