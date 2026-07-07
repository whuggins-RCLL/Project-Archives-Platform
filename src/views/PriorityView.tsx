import { ArrowUpDown, Clock, FileText, CheckCircle2, MoreHorizontal, History, Brain } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Project } from '../types';
import ProjectFilterBar, { DEFAULT_FILTER_QUERY } from '../components/ProjectFilterBar';
import { applyProjectFilters, getFilterOptions, ProjectFilterQuery } from '../lib/projectFilters';
import { useSavedViews } from '../hooks/useSavedViews';

export default function PriorityView({ projects, loading, onProjectClick }: { projects: Project[], loading: boolean, onProjectClick: (id: string) => void }) {
  const [activeSort, setActiveSort] = useState<'priority' | 'owner' | 'category'>('priority');
  const [filterQuery, setFilterQuery] = useState<ProjectFilterQuery>(DEFAULT_FILTER_QUERY);
  const { views, saveView, deleteView } = useSavedViews('priority');

  const filteredProjects = useMemo(() => applyProjectFilters(projects, filterQuery), [projects, filterQuery]);
  const filterOptions = useMemo(() => getFilterOptions(projects), [projects]);

  if (loading) return <div className="p-10">Loading priorities...</div>;

  let sortedProjects = [...filteredProjects];
  if (activeSort === 'owner') {
    sortedProjects.sort((a, b) => a.owner.name.localeCompare(b.owner.name));
  } else if (activeSort === 'category') {
    sortedProjects.sort((a, b) => a.department.localeCompare(b.department));
  }

  const highPriority = sortedProjects.filter(p => p.priority === 'High');
  const mediumPriority = sortedProjects.filter(p => p.priority === 'Medium');
  const lowPriority = sortedProjects.filter(p => p.priority === 'Low');

  return (
    <div className="p-10 min-h-screen max-w-7xl mx-auto">
      <header className="mb-10 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="font-headline text-4xl font-extrabold text-on-surface tracking-tight mb-2">Priority View</h1>
          <p className="text-on-surface-variant font-body max-w-xl">Organize the digital stack by urgency. Use the triage levels to manage librarian focus and AI processing resources.</p>
        </div>
        <div className="flex items-center gap-3 bg-surface-container-low p-1 rounded-xl">
          <button
            onClick={() => setActiveSort('priority')}
            className={`px-4 py-2 shadow-sm rounded-lg text-sm font-semibold flex items-center gap-2 transition-all ${activeSort === 'priority' ? 'bg-white text-primary' : 'hover:bg-white/50 text-on-surface-variant'}`}
          >
            <ArrowUpDown className="w-4 h-4" />
            Priority
          </button>
          <button
            onClick={() => setActiveSort('owner')}
            className={`px-4 py-2 shadow-sm rounded-lg text-sm font-semibold flex items-center gap-2 transition-all ${activeSort === 'owner' ? 'bg-white text-primary' : 'hover:bg-white/50 text-on-surface-variant'}`}
          >
            Owner
          </button>
          <button
            onClick={() => setActiveSort('category')}
            className={`px-4 py-2 shadow-sm rounded-lg text-sm font-semibold flex items-center gap-2 transition-all ${activeSort === 'category' ? 'bg-white text-primary' : 'hover:bg-white/50 text-on-surface-variant'}`}
          >
            Category
          </button>
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

      <div className="space-y-12">
        <section>
          <div className="flex items-center gap-4 mb-6">
            <span className="px-3 py-1 bg-error-container text-error rounded-full text-xs font-bold tracking-widest uppercase">Immediate Action</span>
            <h2 className="font-headline text-xl font-bold">High Priority</h2>
            <div className="flex-1 h-[1px] bg-outline-variant/20"></div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {highPriority.map((project, index) => (
              <div
                key={project.id}
                onClick={() => onProjectClick(project.id)}
                className={`bg-surface-container-lowest p-5 rounded-xl shadow-[0_8px_32px_rgba(25,28,30,0.04)] border border-transparent hover:border-primary/10 transition-all cursor-pointer group ${index === 0 ? '' : 'lg:col-span-2 flex flex-col md:flex-row gap-6'}`}
              >
                {index === 0 ? (
                  <>
                    <div className="flex justify-between items-start mb-4">
                      <span className="text-[10px] font-bold text-on-secondary-container tracking-widest uppercase font-label">REF #{project.id.slice(0, 6).toUpperCase()}</span>
                      <div className="w-2 h-2 rounded-full bg-error"></div>
                    </div>
                    <h3 className="font-headline font-bold text-lg mb-2 group-hover:text-primary transition-colors leading-tight">{project.title}</h3>
                    <p className="text-on-surface-variant text-sm line-clamp-2 mb-4">{project.description}</p>
                    <div className="flex items-center justify-between">
                      <div className="flex -space-x-2">
                        <div className="w-8 h-8 rounded-full border-2 border-white bg-primary-container flex items-center justify-center text-[10px] font-bold text-primary">{project.owner.name.charAt(0)}</div>
                      </div>
                      <span className="text-[11px] font-semibold text-on-surface-variant flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {project.status}
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex-1">
                      <div className="flex justify-between items-start mb-4">
                        <span className="text-[10px] font-bold text-on-secondary-container tracking-widest uppercase font-label">REF #{project.id.slice(0, 6).toUpperCase()}</span>
                        <div className="w-2 h-2 rounded-full bg-error"></div>
                      </div>
                      <h3 className="font-headline font-bold text-lg mb-2 leading-tight group-hover:text-primary transition-colors">{project.title}</h3>
                      <p className="text-on-surface-variant text-sm mb-4 line-clamp-2">{project.description}</p>
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2 px-3 py-1 bg-surface-container rounded-lg">
                          <FileText className="w-3 h-3 text-primary" />
                          <span className="text-xs font-semibold">{project.tags.length} Tags</span>
                        </div>
                        <div className="flex items-center gap-2 px-3 py-1 bg-surface-container rounded-lg">
                          <CheckCircle2 className="w-3 h-3 text-on-tertiary-container" />
                          <span className="text-xs font-semibold">{project.progress}% Complete</span>
                        </div>
                      </div>
                    </div>
                    <div className="w-full md:w-48 h-32 md:h-full rounded-lg overflow-hidden bg-slate-100 flex items-center justify-center text-primary/20">
                      <FileText className="w-12 h-12" />
                    </div>
                  </>
                )}
              </div>
            ))}
            {highPriority.length === 0 && (
              <div className="col-span-3 rounded-xl border border-dashed border-error/40 bg-error-container/30 py-10 text-center">
                <p className="text-sm font-bold uppercase tracking-wider text-error">No high priority projects.</p>
              </div>
            )}
          </div>
        </section>

        <section>
          <div className="flex items-center gap-4 mb-6">
            <span className="px-3 py-1 bg-secondary-container text-on-secondary-container rounded-full text-xs font-bold tracking-widest uppercase">Ongoing Workflow</span>
            <h2 className="font-headline text-xl font-bold">Medium Priority</h2>
            <div className="flex-1 h-[1px] bg-outline-variant/20"></div>
          </div>
          <div className="bg-surface-container-lowest rounded-xl overflow-hidden shadow-[0_4px_16px_rgba(25,28,30,0.02)]">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-surface-container-low/50">
                  <th className="px-6 py-4 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest font-label">Archive Project</th>
                  <th className="px-6 py-4 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest font-label">Owner</th>
                  <th className="px-6 py-4 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest font-label">Status</th>
                  <th className="px-6 py-4 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest font-label">Health</th>
                  <th className="px-6 py-4"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/10">
                {mediumPriority.map(project => (
                  <tr key={project.id} onClick={() => onProjectClick(project.id)} className="hover:bg-surface-container-low transition-colors group cursor-pointer">
                    <td className="px-6 py-4"><div className="flex flex-col"><span className="font-headline font-bold text-on-surface">{project.title}</span><span className="text-xs text-on-surface-variant line-clamp-1">{project.description}</span></div></td>
                    <td className="px-6 py-4"><div className="flex items-center gap-2"><div className="w-6 h-6 rounded-full bg-primary-container flex items-center justify-center text-[10px] font-bold text-primary">{project.owner.name.charAt(0)}</div><span className="text-sm font-medium text-on-surface">{project.owner.name}</span></div></td>
                    <td className="px-6 py-4"><span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase ${
                      project.status === 'In Progress' ? 'bg-surface-container-high text-secondary' :
                      project.status === 'Launched' ? 'bg-tertiary-container text-tertiary-fixed' :
                      'bg-surface-container-low text-on-surface-variant'
                    }`}>{project.status}</span></td>
                    <td className="px-6 py-4"><div className="w-24 h-1.5 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-tertiary-fixed-dim" style={{ width: `${project.progress}%` }}></div></div></td>
                    <td className="px-6 py-4 text-right"><button aria-label={`Open ${project.title}`} title="Open project record" onClick={() => onProjectClick(project.id)} className="text-on-surface-variant opacity-0 group-hover:opacity-100 transition-opacity"><MoreHorizontal className="w-5 h-5" /></button></td>
                  </tr>
                ))}
                {mediumPriority.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-10 text-center">
                      <p className="text-sm font-bold uppercase tracking-wider text-on-surface-variant">No medium priority projects.</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <div className="flex items-center gap-4 mb-6">
            <span className="px-3 py-1 bg-surface-container-high text-on-surface-variant rounded-full text-xs font-bold tracking-widest uppercase">Background Tasks</span>
            <h2 className="font-headline text-xl font-bold">Low Priority</h2>
            <div className="flex-1 h-[1px] bg-outline-variant/20"></div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {lowPriority.map((project, index) => (
              <div
                key={project.id}
                onClick={() => onProjectClick(project.id)}
                className={`p-5 rounded-xl border border-outline-variant/20 group cursor-pointer hover:border-primary/30 transition-colors ${
                  index % 3 === 2 ? 'md:col-span-2 bg-primary text-on-primary flex items-center justify-between relative overflow-hidden' : 'md:col-span-1 bg-surface-container-low/40'
                }`}
              >
                {index % 3 === 2 ? (
                  <>
                    <div className="relative z-10"><h4 className="font-headline font-bold text-lg mb-1 leading-tight">{project.title}</h4><p className="text-xs text-on-primary/75 max-w-[200px] line-clamp-2">{project.description}</p></div>
                    <Brain className="w-24 h-24 text-on-primary/10 absolute -right-4 -bottom-4" />
                    <button onClick={() => onProjectClick(project.id)} className="relative z-10 px-4 py-2 bg-on-primary/10 hover:bg-on-primary/20 rounded-lg text-xs font-bold transition-all">View</button>
                  </>
                ) : (
                  <>
                    <History className="w-6 h-6 text-primary mb-3" />
                    <h4 className="font-headline font-bold text-sm mb-1 line-clamp-1">{project.title}</h4>
                    <p className="text-xs text-on-surface-variant line-clamp-2">{project.description}</p>
                  </>
                )}
              </div>
            ))}
            {lowPriority.length === 0 && (
              <div className="col-span-4 rounded-xl border border-dashed border-outline-variant/40 bg-surface-container-low/40 py-10 text-center">
                <p className="text-sm font-bold uppercase tracking-wider text-on-surface-variant">No low priority projects.</p>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
