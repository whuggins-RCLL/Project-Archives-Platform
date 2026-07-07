import { useMemo } from 'react';
import { FolderKanban, Crown, Users, Globe, Lock, ChevronRight } from 'lucide-react';
import { auth } from '../lib/firebase';
import { Project } from '../types';

function normalize(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

interface MyProjectRelation {
  project: Project;
  isOwner: boolean;
  isCollaborator: boolean;
}

export default function MyProjectsView({
  projects,
  loading,
  onProjectClick,
}: {
  projects: Project[];
  loading: boolean;
  onProjectClick: (id: string) => void;
}) {
  const currentUid = auth.currentUser?.uid ?? '';
  const currentName = normalize(auth.currentUser?.displayName ?? undefined);
  const currentEmail = normalize(auth.currentUser?.email ?? undefined);

  const myProjects = useMemo<MyProjectRelation[]>(() => {
    const matchesMember = (member: { uid?: string; name?: string } | undefined): boolean => {
      if (!member) return false;
      if (currentUid && member.uid === currentUid) return true;
      const memberName = normalize(member.name);
      if (!memberName) return false;
      return (currentName.length > 0 && memberName === currentName)
        || (currentEmail.length > 0 && memberName === currentEmail);
    };

    return projects
      .map((project) => {
        const isOwner = matchesMember(project.owner);
        const isCollaborator = (project.collaborators ?? []).some((member) => matchesMember(member));
        return { project, isOwner, isCollaborator };
      })
      .filter((relation) => relation.isOwner || relation.isCollaborator);
  }, [projects, currentUid, currentName, currentEmail]);

  if (loading) return <div className="p-10">Loading your projects...</div>;

  return (
    <div className="p-10 max-w-6xl mx-auto">
      <header className="mb-8">
        <h2 className="font-headline text-3xl font-extrabold tracking-tight text-on-surface flex items-center gap-3">
          <FolderKanban className="w-8 h-8 text-primary" />
          My Projects
        </h2>
        <p className="text-on-surface-variant mt-1 font-medium">
          Projects you own or collaborate on. Select one to open its full record.
        </p>
      </header>

      {myProjects.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-outline-variant/40 bg-surface-container-lowest/70 py-20 text-center">
          <FolderKanban className="w-12 h-12 text-primary/50 mb-4" />
          <h3 className="text-lg font-bold text-on-surface">No projects assigned to you yet</h3>
          <p className="text-sm text-on-surface-variant mt-2 max-w-md">
            When you are set as a project owner or added as a collaborator, those projects will appear here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {myProjects.map(({ project, isOwner, isCollaborator }) => {
            const isPublic = project.isPublic !== false;
            return (
              <button
                key={project.id}
                onClick={() => onProjectClick(project.id)}
                className="group text-left bg-surface-container-lowest rounded-xl p-5 shadow-sm border border-outline-variant/15 hover:shadow-md hover:-translate-y-0.5 transition-all focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                <div className="flex items-center justify-between gap-2 mb-3">
                  <span className="text-[10px] font-bold text-on-surface-variant bg-surface-container px-1.5 py-0.5 rounded">{project.code}</span>
                  <div className="flex items-center gap-1.5">
                    {isOwner && (
                      <span className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-tighter bg-primary/10 text-primary" title="You own this project">
                        <Crown className="w-2.5 h-2.5" /> Owner
                      </span>
                    )}
                    {isCollaborator && (
                      <span className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-tighter bg-secondary-container text-on-secondary-fixed" title="You collaborate on this project">
                        <Users className="w-2.5 h-2.5" /> Collaborator
                      </span>
                    )}
                  </div>
                </div>
                <h3 className="font-bold text-base leading-snug text-on-surface mb-2">{project.title}</h3>
                <p className="text-xs text-on-surface-variant line-clamp-2 mb-4">{project.description}</p>
                <div className="flex items-center justify-between text-[11px] text-on-surface-variant">
                  <span className="font-medium">{project.status}</span>
                  <span className="inline-flex items-center gap-1">
                    {isPublic ? <Globe className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                    {isPublic ? 'Public' : 'Private'}
                  </span>
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-outline-variant/10 pt-3">
                  <div className="flex items-center gap-2">
                    {project.owner.avatar ? (
                      <img className="w-6 h-6 rounded-full object-cover" src={project.owner.avatar} alt={project.owner.name} />
                    ) : (
                      <div className="w-6 h-6 rounded-full bg-primary-fixed flex items-center justify-center text-[10px] font-bold text-primary">{project.owner.initials}</div>
                    )}
                    <span className="text-[11px] font-medium text-on-surface-variant">{project.owner.name}</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-on-surface-variant opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
