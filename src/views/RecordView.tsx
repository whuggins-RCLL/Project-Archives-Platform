import { Clock, Brain, Map, ShieldCheck, MessageSquare, Send, Link as LinkIcon, FileText, X, AlertTriangle, CheckCircle2, Trash2, Sparkles, Loader2, Plus, Paperclip, SmilePlus, MessageCircleReply, Pencil } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, Settings } from '../lib/api';
import { ApprovalCheckpoint, Milestone, Project, Comment, CommentAttachment, Dependency, ProjectStatus, AIDraft, AIDraftRecommendation, AIDuplicateCandidate } from '../types';
import { withGovernanceDefaults } from '../lib/projectGovernance';
import { COMMENT_REACTION_EMOJIS } from '../lib/uiDefaults';
import { AI_MODEL_OPTIONS } from '../constants';

export default function RecordView({ projects, loading: projectsLoading, projectId, onBack, isAdmin }: { projects: Project[], loading: boolean, projectId: string | null, onBack: () => void, isAdmin: boolean }) {
  const [project, setProject] = useState<Project | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loadingComments, setLoadingComments] = useState(true);
  const [newComment, setNewComment] = useState('');
  const [attachments, setAttachments] = useState<CommentAttachment[]>([]);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [replyAttachments, setReplyAttachments] = useState<Record<string, CommentAttachment[]>>({});
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [generatingTags, setGeneratingTags] = useState(false);
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [generatingActions, setGeneratingActions] = useState(false);
  const [generatingRiskNarrative, setGeneratingRiskNarrative] = useState(false);
  const [generatingDuplicates, setGeneratingDuplicates] = useState(false);
  const [savingProject, setSavingProject] = useState(false);
  const [addingComment, setAddingComment] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [attachmentModalTarget, setAttachmentModalTarget] = useState<'root' | string | null>(null);
  const [attachmentUrlDraft, setAttachmentUrlDraft] = useState('');
  const [attachmentLabelDraft, setAttachmentLabelDraft] = useState('');
  const [isTagModalOpen, setIsTagModalOpen] = useState(false);
  const [tagDraft, setTagDraft] = useState('');
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [selectedModel, setSelectedModel] = useState(AI_MODEL_OPTIONS[0]?.id ?? '');

  useEffect(() => {
    api.getSettings().then(setSettings);
  }, []);

  useEffect(() => {
    if (projectId && projects.length > 0) {
      const foundProject = projects.find(p => p.id === projectId);
      if (foundProject) setProject(withGovernanceDefaults(foundProject));
    }
  }, [projectId, projects]);

  useEffect(() => {
    if (!projectId) return;
    const unsubscribe = api.subscribeToComments(
      projectId,
      (commentsData) => {
        setComments(commentsData);
        setLoadingComments(false);
      },
      (error) => {
        console.error(error);
        setLoadingComments(false);
      }
    );
    return () => unsubscribe();
  }, [projectId]);

  useEffect(() => {
    if (!settings?.activeProvider) return;
    const providerOptions = AI_MODEL_OPTIONS.filter((option) => option.provider === settings.activeProvider);
    if (providerOptions.length > 0) {
      setSelectedModel(providerOptions[0].id);
    }
  }, [settings?.activeProvider]);

  const handleSave = async () => {
    if (!isAdmin) return;
    if (!project) return;
    setSavingProject(true);
    try {
      if (settings?.privacyMode === 'public-read' && (project.aiDrafts?.length ?? 0) > 0) {
        const { aiDrafts: _omittedDrafts, ...projectWithoutDrafts } = project;
        await api.updateProject(project.id, projectWithoutDrafts);
      } else {
        await api.updateProject(project.id, project);
      }
      setToast({ type: 'success', message: 'Project saved successfully.' });
      onBack();
    } catch (error) {
      console.error(error);
      setToast({ type: 'error', message: 'Failed to save changes. Please try again.' });
    } finally {
      setSavingProject(false);
    }
  };

  const handleDelete = async () => {
    if (!isAdmin) return;
    if (!project) return;
    try {
      await api.deleteProject(project.id);
      onBack();
    } catch (error) {
      console.error(error);
      setToast({ type: 'error', message: 'Failed to delete project. Please try again.' });
    } finally {
      setIsDeleteModalOpen(false);
    }
  };

  const extractMentions = (value: string): string[] => (
    Array.from(new Set((value.match(/@[\w.-]+/g) ?? []).map((token) => token.slice(1)))).slice(0, 20)
  );

  const handleAddComment = async () => {
    if (!newComment.trim() || !project || addingComment) return;
    setAddingComment(true);
    try {
      await api.addComment(project.id, newComment, {
        mentions: extractMentions(newComment),
        attachments,
      });
      setNewComment('');
      setAttachments([]);
    } catch (error) {
      console.error(error);
      setToast({ type: 'error', message: 'Failed to post comment. Please try again.' });
    } finally {
      setAddingComment(false);
    }
  };

  const handleReply = async (parentId: string) => {
    if (!project) return;
    const draft = replyDrafts[parentId]?.trim();
    if (!draft) return;

    try {
      await api.addComment(project.id, draft, {
        parentId,
        mentions: extractMentions(draft),
        attachments: replyAttachments[parentId] ?? [],
      });
      setReplyDrafts((prev) => ({ ...prev, [parentId]: '' }));
      setReplyAttachments((prev) => ({ ...prev, [parentId]: [] }));
    } catch (error) {
      console.error(error);
    }
  };

  const beginEdit = (comment: Comment) => {
    setEditingCommentId(comment.id);
    setEditDraft(comment.text);
  };

  const handleSaveEdit = async (comment: Comment) => {
    if (!editDraft.trim()) return;
    try {
      await api.updateCommentText(comment, editDraft.trim());
      setEditingCommentId(null);
      setEditDraft('');
    } catch (error) {
      console.error(error);
    }
  };

  const handleToggleReaction = async (comment: Comment, emoji: string) => {
    try {
      await api.toggleCommentReaction(comment, emoji);
    } catch (error) {
      console.error(error);
    }
  };

  const handleAddAttachment = (target: 'root' | string) => {
    const url = attachmentUrlDraft.trim();
    if (!url) {
      setToast({ type: 'error', message: 'Please enter an attachment URL.' });
      return;
    }

    const name = attachmentLabelDraft.trim() || 'Attachment';
    const nextAttachment: CommentAttachment = {
      id: `att-${Date.now()}`,
      name,
      url,
    };

    if (target === 'root') {
      setAttachments((prev) => [...prev, nextAttachment].slice(0, 5));
      setAttachmentModalTarget(null);
      setAttachmentUrlDraft('');
      setAttachmentLabelDraft('');
      return;
    }

    setReplyAttachments((prev) => ({
      ...prev,
      [target]: [...(prev[target] ?? []), nextAttachment].slice(0, 5),
    }));
    setAttachmentModalTarget(null);
    setAttachmentUrlDraft('');
    setAttachmentLabelDraft('');
  };

  const handleAddTag = () => {
    if (!project || !isAdmin) return;
    const newTag = tagDraft.trim();
    if (!newTag) {
      setToast({ type: 'error', message: 'Tag cannot be empty.' });
      return;
    }
    if (project.tags.includes(newTag)) {
      setToast({ type: 'error', message: 'That tag already exists.' });
      return;
    }
    setProject({ ...project, tags: [...project.tags, newTag] });
    setTagDraft('');
    setIsTagModalOpen(false);
  };

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const handleAutoTag = async () => {
    if (!isAdmin) return;
    if (!project || !settings?.aiEnabled || !settings.aiAutoTagEnabled) return;
    setGeneratingTags(true);
    try {
      const prompt = `Based on the following project description, generate 3-5 relevant tags. Return ONLY a comma-separated list of tags, nothing else. Description: ${project.description}`;
      const response = await api.generateAI(
        prompt,
        settings.activeProvider,
        selectedModel,
        "You are an expert project manager. Generate concise, relevant tags.",
        "autoTag",
      );
      const newTags = response.split(',').map(t => t.trim()).filter(t => t && !project.tags.includes(t));
      if (newTags.length > 0) {
        setProject({ ...project, tags: [...project.tags, ...newTags].slice(0, 20) });
        setToast({ type: 'success', message: `Added ${newTags.length} new AI-generated tag${newTags.length === 1 ? '' : 's'}.` });
      } else {
        setToast({ type: 'success', message: 'No new tags found from AI suggestions.' });
      }
    } catch (error) {
      console.error(error);
      setToast({ type: 'error', message: 'Failed to generate tags. Check API configuration.' });
    } finally {
      setGeneratingTags(false);
    }
  };

  const handleSummarize = async () => {
    if (!isAdmin) return;
    if (!project || !settings?.aiEnabled || !settings.aiSummarizeEnabled) return;
    setGeneratingSummary(true);
    try {
      const commentsText = comments.map(c => `${c.author.name}: ${c.text}`).join('\n');
      const prompt = `Summarize the following project and its recent comments into a concise executive summary (2-3 sentences max). \n\nProject Title: ${project.title}\nCurrent Description: ${project.description}\n\nRecent Comments:\n${commentsText}`;
      const response = await api.generateAI(
        prompt,
        settings.activeProvider,
        selectedModel,
        "You are an executive assistant. Provide a concise, professional summary.",
        "summarize",
      );
      setProject({ ...project, description: response.trim() });
    } catch (error) {
      console.error(error);
      alert("Failed to generate summary. Check API configuration.");
    } finally {
      setGeneratingSummary(false);
    }
  };



  const parseJsonBlock = <T,>(raw: string, fallback: T): T => {
    const fenced = raw.match(/```json\s*([\s\S]*?)```/i);
    const candidate = fenced?.[1] ?? raw;
    try {
      return JSON.parse(candidate) as T;
    } catch {
      return fallback;
    }
  };

  const applyDraft = (draft: AIDraft) => {
    if (!project) return;
    setProject({
      ...project,
      aiDrafts: [draft, ...(project.aiDrafts ?? [])].slice(0, 30)
    });
  };

  const getDefaultDraftStatus = () => settings?.aiRequireHumanApproval ? 'pending' : 'approved';

  const overlapScore = (left: Project, right: Project): number => {
    const leftTokens = new Set(`${left.title} ${left.description}`.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
    const rightTokens = new Set(`${right.title} ${right.description}`.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
    const overlap = Array.from(leftTokens).filter((token) => rightTokens.has(token));
    return Math.round((overlap.length / Math.max(leftTokens.size, 1)) * 100);
  };

  const handleGenerateNextActions = async () => {
    if (!isAdmin || !project || !settings?.aiEnabled || !settings.aiNextBestActionEnabled) return;
    setGeneratingActions(true);
    try {
      const prompt = `Return valid JSON with this schema: {"confidence":number,"explanation":string,"actions":[{"label":string,"rationale":string,"priority":"Low|Medium|High"}]}. Give up to 4 actions. Context:
Title: ${project.title}
Status: ${project.status}
Priority: ${project.priority}
Risk: ${project.riskFactor}
Description: ${project.description}`;
      const response = await api.generateAI(
        prompt,
        settings.activeProvider,
        selectedModel,
        'You are a PMO copilot. Return strict JSON only.',
        'nextBestAction',
      );
      const parsed = parseJsonBlock<{ confidence?: number; explanation?: string; actions?: AIDraftRecommendation[] }>(response, {});
      const actions = (parsed.actions ?? []).slice(0, 4).map((item, index) => ({
        id: `act-${Date.now()}-${index}`,
        label: item.label || 'Follow-up action',
        rationale: item.rationale || 'No rationale provided.',
        priority: item.priority ?? 'Medium'
      }));

      applyDraft({
        id: `draft-${Date.now()}-actions`,
        type: 'nextBestAction',
        generatedAt: new Date().toISOString(),
        generatedBy: api.getCurrentUserId() ?? undefined,
        confidence: Math.max(0, Math.min(100, Math.round(parsed.confidence ?? 72))),
        explanation: parsed.explanation ?? 'Derived from project metadata and lifecycle stage.',
        status: getDefaultDraftStatus(),
        approvedAt: settings.aiRequireHumanApproval ? undefined : new Date().toISOString(),
        approvedBy: settings.aiRequireHumanApproval ? undefined : api.getCurrentUserId() ?? undefined,
        nextBestActions: actions,
      });
    } catch (error) {
      console.error(error);
      alert('Failed to generate next-best actions.');
    } finally {
      setGeneratingActions(false);
    }
  };

  const handleGenerateRiskNarrative = async () => {
    if (!isAdmin || !project || !settings?.aiEnabled || !settings.aiRiskNarrativeEnabled) return;
    setGeneratingRiskNarrative(true);
    try {
      const prompt = `Draft a concise risk narrative (max 130 words) plus confidence and explanation as JSON: {"confidence":number,"explanation":string,"riskNarrative":string}.
Project: ${project.title}
Status: ${project.status}
Risk: ${project.riskFactor}
Dependencies: ${(project.dependencies ?? []).map((d) => `${d.description} (${d.status})`).join('; ') || 'none'}
Pending approvals: ${(project.approvalCheckpoints ?? []).filter((c) => c.required && !c.approved).length}`;
      const response = await api.generateAI(
        prompt,
        settings.activeProvider,
        selectedModel,
        'You are an enterprise risk analyst. Return strict JSON only.',
        'riskNarrative',
      );
      const parsed = parseJsonBlock<{ confidence?: number; explanation?: string; riskNarrative?: string }>(response, {});

      applyDraft({
        id: `draft-${Date.now()}-risk`,
        type: 'riskNarrative',
        generatedAt: new Date().toISOString(),
        generatedBy: api.getCurrentUserId() ?? undefined,
        confidence: Math.max(0, Math.min(100, Math.round(parsed.confidence ?? 68))),
        explanation: parsed.explanation ?? 'Built from dependencies, stage gates, and stated project risk factor.',
        status: getDefaultDraftStatus(),
        approvedAt: settings.aiRequireHumanApproval ? undefined : new Date().toISOString(),
        approvedBy: settings.aiRequireHumanApproval ? undefined : api.getCurrentUserId() ?? undefined,
        riskNarrative: parsed.riskNarrative ?? 'Risk narrative unavailable. Please regenerate.',
      });
    } catch (error) {
      console.error(error);
      alert('Failed to generate risk narrative.');
    } finally {
      setGeneratingRiskNarrative(false);
    }
  };

  const handleDetectDuplicates = async () => {
    if (!isAdmin || !project || !settings?.aiEnabled || !settings.aiDuplicateDetectionEnabled) return;
    setGeneratingDuplicates(true);
    try {
      const heuristicMatches = projects
        .filter((candidate) => candidate.id !== project.id)
        .map((candidate) => ({ candidate, score: overlapScore(project, candidate) }))
        .filter((item) => item.score >= 25)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);

      const candidates: AIDuplicateCandidate[] = heuristicMatches.map(({ candidate, score }) => ({
        projectId: candidate.id,
        code: candidate.code,
        title: candidate.title,
        overlapScore: score,
        overlapReason: 'Heuristic overlap on title/description tokens.'
      }));

      applyDraft({
        id: `draft-${Date.now()}-dup`,
        type: 'duplicateDetection',
        generatedAt: new Date().toISOString(),
        generatedBy: api.getCurrentUserId() ?? undefined,
        confidence: candidates.length > 0 ? Math.min(95, candidates[0].overlapScore) : 40,
        explanation: candidates.length > 0 ? 'Possible overlap based on lexical similarity.' : 'No strong overlap found among current projects.',
        status: getDefaultDraftStatus(),
        approvedAt: settings.aiRequireHumanApproval ? undefined : new Date().toISOString(),
        approvedBy: settings.aiRequireHumanApproval ? undefined : api.getCurrentUserId() ?? undefined,
        duplicateCandidates: candidates,
      });
    } catch (error) {
      console.error(error);
      alert('Failed to run duplicate detection.');
    } finally {
      setGeneratingDuplicates(false);
    }
  };

  const updateDraftStatus = (draftId: string, status: 'approved' | 'rejected') => {
    if (!project || !isAdmin) return;
    const now = new Date().toISOString();
    const uid = api.getCurrentUserId() ?? undefined;
    setProject({
      ...project,
      aiDrafts: (project.aiDrafts ?? []).map((draft) => {
        if (draft.id !== draftId) return draft;
        return {
          ...draft,
          status,
          approvedAt: status === 'approved' ? now : undefined,
          approvedBy: status === 'approved' ? uid : undefined,
          rejectedAt: status === 'rejected' ? now : undefined,
          rejectedBy: status === 'rejected' ? uid : undefined,
        };
      })
    });
  };

  const updateMilestone = (id: string, updates: Partial<Milestone>) => {
    if (!project) return;
    setProject({
      ...project,
      milestones: (project.milestones ?? []).map((milestone) => (
        milestone.id === id ? { ...milestone, ...updates } : milestone
      ))
    });
  };

  const addMilestone = () => {
    if (!project || !isAdmin) return;
    setProject({
      ...project,
      milestones: [
        ...(project.milestones ?? []),
        {
          id: `ms-${Date.now()}`,
          title: 'New milestone',
          stage: project.status,
          status: 'Not Started'
        }
      ]
    });
  };

  const removeMilestone = (id: string) => {
    if (!project || !isAdmin) return;
    setProject({
      ...project,
      milestones: (project.milestones ?? []).filter((milestone) => milestone.id !== id)
    });
  };

  const updateDependency = (id: string, updates: Partial<Dependency>) => {
    if (!project) return;
    setProject({
      ...project,
      dependencies: (project.dependencies ?? []).map((dependency) => (
        dependency.id === id ? { ...dependency, ...updates } : dependency
      ))
    });
  };

  const addDependency = () => {
    if (!project || !isAdmin) return;
    setProject({
      ...project,
      dependencies: [
        ...(project.dependencies ?? []),
        {
          id: `dep-${Date.now()}`,
          type: 'Depends On',
          description: 'New dependency',
          status: 'On Track'
        }
      ]
    });
  };

  const removeDependency = (id: string) => {
    if (!project || !isAdmin) return;
    setProject({
      ...project,
      dependencies: (project.dependencies ?? []).filter((dependency) => dependency.id !== id)
    });
  };

  const updateApproval = (id: string, updates: Partial<ApprovalCheckpoint>) => {
    if (!project) return;
    setProject({
      ...project,
      approvalCheckpoints: (project.approvalCheckpoints ?? []).map((checkpoint) => (
        checkpoint.id === id ? { ...checkpoint, ...updates } : checkpoint
      ))
    });
  };

  const pendingApprovals = (project?.approvalCheckpoints ?? []).filter((checkpoint) => checkpoint.required && !checkpoint.approved).length;
  const blockedDependencies = (project?.dependencies ?? []).filter((dependency) => dependency.status === 'At Risk').length;
  const currentUserId = api.getCurrentUserId();

  const topLevelComments = comments.filter((comment) => !comment.parentId);
  const repliesByParent = comments.reduce<Record<string, Comment[]>>((acc, comment) => {
    if (!comment.parentId) return acc;
    acc[comment.parentId] = [...(acc[comment.parentId] ?? []), comment];
    return acc;
  }, {});

  const renderRichText = (text: string) => {
    const parts = text.split(/(@[\w.-]+)/g);
    return parts.map((part, index) => {
      if (part.startsWith('@')) {
        return <span key={`${part}-${index}`} className="text-primary font-semibold">{part}</span>;
      }
      return <span key={`${part}-${index}`}>{part}</span>;
    });
  };

  if (!projectId) {
    return (
      <div className="p-10 flex flex-col items-center justify-center h-full">
        <h2 className="text-xl font-bold text-on-surface-variant mb-4">No Project Selected</h2>
        <button onClick={onBack} className="px-6 py-2 bg-primary text-white rounded-lg">Back to Board</button>
      </div>
    );
  }

  if (projectsLoading || loadingComments || !project) return <div className="p-10">Loading project details...</div>;

  return (
    <div className="p-10 max-w-7xl mx-auto">
      {toast && (
        <div className="fixed top-6 right-6 z-50">
          <div className={`px-4 py-3 rounded-lg shadow-lg border text-sm font-bold ${
            toast.type === 'success'
              ? 'bg-tertiary-container text-on-tertiary-container border-tertiary-fixed/30'
              : 'bg-error-container text-error border-error/30'
          }`}>
            {toast.message}
          </div>
        </div>
      )}
      <div className="flex justify-between items-end mb-10">
        <div>
          <nav className="flex gap-2 text-xs font-bold tracking-widest text-on-surface-variant mb-2 uppercase cursor-pointer" onClick={onBack}>
            <span className="hover:text-primary">Portfolio</span>
            <span>/</span>
            <span>Project Record</span>
          </nav>
          <h1 className="font-headline text-4xl font-extrabold text-on-surface tracking-tight">{project.title}</h1>
          <p className="text-on-surface-variant mt-2 flex items-center gap-2">
            <Clock className="w-4 h-4" />
            Code: {project.code} • Status: {project.status}
          </p>
        </div>
        <div className="flex gap-3">
          {isAdmin && (
            <button onClick={() => setIsDeleteModalOpen(true)} className="px-4 py-2 border border-error text-error font-bold rounded-sm hover:bg-error-container transition-colors flex items-center gap-2" title="Delete Project">
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          <button onClick={onBack} className="px-6 py-2 border border-outline-variant text-primary font-bold rounded-sm hover:bg-surface-container-low transition-colors">
            Cancel
          </button>
          {isAdmin && (
            <button
              onClick={handleSave}
              disabled={savingProject}
              className="px-8 py-2 bg-gradient-to-b from-primary to-primary-container text-white font-bold rounded-sm shadow-lg hover:opacity-90 transition-opacity disabled:opacity-70 disabled:cursor-not-allowed inline-flex items-center gap-2"
            >
              {savingProject && <Loader2 className="w-4 h-4 animate-spin" />}
              {savingProject ? 'Saving...' : 'Save Changes'}
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-12 lg:col-span-8 space-y-6">
          <section className="bg-surface-container-lowest p-8 rounded-lg shadow-sm">
            <h2 className="font-headline text-xl font-bold mb-6 flex items-center gap-2">
              <Brain className="w-6 h-6 text-primary" />
              Core & AI Specification
            </h2>
            <div className="grid grid-cols-2 gap-6">
              <div className="col-span-2 md:col-span-1">
                <label htmlFor="record-project-name" className="block text-xs font-bold text-on-surface-variant uppercase mb-2">Project Name</label>
                <input 
                  id="record-project-name"
                  className="w-full bg-surface-container-low border-none rounded-lg p-3 focus:ring-2 focus:ring-primary outline-none" 
                  type="text" 
                  value={project.title} 
                  onChange={(e) => setProject({...project, title: e.target.value})}
                  disabled={!isAdmin}
                />
              </div>
              <div className="col-span-2 md:col-span-1">
                <label htmlFor="record-project-department" className="block text-xs font-bold text-on-surface-variant uppercase mb-2">Department</label>
                <input 
                  id="record-project-department"
                  className="w-full bg-surface-container-low border-none rounded-lg p-3 focus:ring-2 focus:ring-primary outline-none" 
                  type="text" 
                  value={project.department} 
                  onChange={(e) => setProject({...project, department: e.target.value})}
                  disabled={!isAdmin}
                />
              </div>
              <div className="col-span-2">
                <div className="flex justify-between items-end mb-2">
                  <p className="block text-xs font-bold text-on-surface-variant uppercase">Tags</p>
                  {settings?.aiEnabled && settings.aiAutoTagEnabled && isAdmin && (
                    <button 
                      onClick={handleAutoTag}
                      disabled={generatingTags}
                      className="text-[10px] font-bold flex items-center gap-1 text-primary hover:bg-primary/10 px-2 py-1 rounded transition-colors disabled:opacity-50"
                    >
                      {generatingTags ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                      Auto-Tag
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 p-3 bg-surface-container-low rounded-lg min-h-[46px]">
                  {project.tags.map(tag => (
                    <span key={tag} className="bg-secondary-container text-on-secondary-fixed text-xs font-bold px-3 py-1 rounded-full flex items-center gap-1">
                      {tag} {isAdmin && <X className="w-3 h-3 cursor-pointer" onClick={() => setProject({...project, tags: project.tags.filter(t => t !== tag)})} />}
                    </span>
                  ))}
                  <button 
                    disabled={!isAdmin}
                    className="text-primary text-xs font-bold flex items-center gap-1 ml-2"
                    onClick={() => setIsTagModalOpen(true)}
                  >+ Add Tag</button>
                </div>
              </div>
              <div className="md:col-span-1">
                <label htmlFor="record-project-priority" className="block text-xs font-bold text-on-surface-variant uppercase mb-2">Priority</label>
                <select 
                  id="record-project-priority"
                  className="w-full bg-surface-container-low border-none rounded-lg p-3 focus:ring-2 focus:ring-primary outline-none"
                  value={project.priority}
                  onChange={(e) => setProject({...project, priority: e.target.value as Project['priority']})}
                  disabled={!isAdmin}
                >
                  <option value="Low">Low</option>
                  <option value="Medium">Medium</option>
                  <option value="High">High</option>
                </select>
              </div>
              <div className="md:col-span-1">
                <label htmlFor="record-project-risk-factor" className="block text-xs font-bold text-on-surface-variant uppercase mb-2">Risk Factor</label>
                <select 
                  id="record-project-risk-factor"
                  className="w-full bg-surface-container-low border-none rounded-lg p-3 focus:ring-2 focus:ring-primary outline-none"
                  value={project.riskFactor}
                  onChange={(e) => setProject({...project, riskFactor: e.target.value})}
                  disabled={!isAdmin}
                >
                  <option value="Low">Low</option>
                  <option value="Medium">Medium</option>
                  <option value="High">High</option>
                  <option value="Stable">Stable</option>
                </select>
              </div>
            </div>
          </section>

          <section className="bg-surface-container-lowest p-8 rounded-lg shadow-sm">
            <h2 className="font-headline text-xl font-bold mb-6 flex items-center gap-2">
              <Map className="w-6 h-6 text-primary" />
              Strategic Planning
            </h2>
            <div className="space-y-6">
              <div>
                <div className="flex justify-between items-end mb-2">
                  <label htmlFor="record-project-summary" className="block text-xs font-bold text-on-surface-variant uppercase">Executive Summary</label>
                  {settings?.aiEnabled && settings.aiSummarizeEnabled && isAdmin && (
                    <button 
                      onClick={handleSummarize}
                      disabled={generatingSummary}
                      className="text-[10px] font-bold flex items-center gap-1 text-primary hover:bg-primary/10 px-2 py-1 rounded transition-colors disabled:opacity-50"
                    >
                      {generatingSummary ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                      AI Summarize
                    </button>
                  )}
                </div>
                <textarea
                  id="record-project-summary"
                  className="w-full bg-surface-container-low border-none rounded-lg p-3 focus:ring-2 focus:ring-primary outline-none resize-y" 
                  rows={3} 
                  value={project.description}
                  onChange={(e) => setProject({...project, description: e.target.value})}
                  disabled={!isAdmin}
                ></textarea>
              </div>
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <p className="block text-xs font-bold text-on-surface-variant uppercase mb-2">Primary Outcomes</p>
                  <ul className="space-y-2">
                    <li className="flex items-center gap-2">
                      <input className="flex-1 text-sm bg-transparent border-b border-outline-variant py-1 focus:border-primary outline-none" type="text" defaultValue="Reduces search time by 40%" />
                    </li>
                    <li className="flex items-center gap-2">
                      <input className="flex-1 text-sm bg-transparent border-b border-outline-variant py-1 focus:border-primary outline-none" type="text" defaultValue="Cross-lingual discovery" />
                    </li>
                  </ul>
                </div>
                <div>
                  <label className="block text-xs font-bold text-on-surface-variant uppercase mb-2">Key Deliverables</label>
                  <ul className="space-y-2">
                    <li className="flex items-center gap-2 text-sm text-on-surface">
                      <CheckCircle2 className="w-4 h-4 text-tertiary-fixed-variant" />
                      Architecture Doc v1
                    </li>
                    <li className="flex items-center gap-2 text-sm text-on-surface">
                      <div className="w-4 h-4 rounded-full border-2 border-on-surface-variant"></div>
                      Model Weights Repository
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </section>

          <section className="bg-surface-container-lowest p-8 rounded-lg shadow-sm">
            <h2 className="font-headline text-xl font-bold mb-6 flex items-center gap-2">
              <Sparkles className="w-6 h-6 text-primary" />
              AI Decision Support Workflow
            </h2>
            {settings?.aiEnabled && isAdmin && (
              <div className="mb-4 max-w-xl">
                <label htmlFor="ai-model-select" className="block text-xs font-bold text-on-surface-variant uppercase mb-2">
                  AI Model
                </label>
                <select
                  id="ai-model-select"
                  className="w-full bg-surface-container-low border border-outline-variant/30 rounded-lg p-2 text-sm focus:ring-2 focus:ring-primary outline-none"
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                >
                  {AI_MODEL_OPTIONS
                    .filter((option) => option.provider === settings.activeProvider)
                    .map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label} — {option.description}
                      </option>
                    ))}
                </select>
              </div>
            )}
            <div className="flex flex-wrap gap-2 mb-4">
              {settings?.aiEnabled && settings.aiNextBestActionEnabled && isAdmin && (
                <button onClick={handleGenerateNextActions} disabled={generatingActions} className="px-3 py-2 text-xs font-bold rounded-md bg-primary/10 text-primary disabled:opacity-60 flex items-center gap-2">
                  {generatingActions ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />} Generate Next-best Actions
                </button>
              )}
              {settings?.aiEnabled && settings.aiRiskNarrativeEnabled && isAdmin && (
                <button onClick={handleGenerateRiskNarrative} disabled={generatingRiskNarrative} className="px-3 py-2 text-xs font-bold rounded-md bg-primary/10 text-primary disabled:opacity-60 flex items-center gap-2">
                  {generatingRiskNarrative ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />} Draft Risk Narrative
                </button>
              )}
              {settings?.aiEnabled && settings.aiDuplicateDetectionEnabled && isAdmin && (
                <button onClick={handleDetectDuplicates} disabled={generatingDuplicates} className="px-3 py-2 text-xs font-bold rounded-md bg-primary/10 text-primary disabled:opacity-60 flex items-center gap-2">
                  {generatingDuplicates ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />} Detect Duplicates
                </button>
              )}
            </div>
            <div className="space-y-3">
              {(project.aiDrafts ?? []).length === 0 && (
                <p className="text-xs text-on-surface-variant">No AI drafts yet. Generate a draft, then approve or reject before downstream use.</p>
              )}
              {(project.aiDrafts ?? []).map((draft) => (
                <div key={draft.id} className="border border-outline-variant/30 rounded-lg p-3 bg-surface-container-low">
                  <div className="flex flex-wrap justify-between gap-2 items-center">
                    <div>
                      <div className="text-xs font-bold uppercase tracking-wide">{draft.type}</div>
                      <div className="text-[11px] text-on-surface-variant">Confidence {draft.confidence}% · {new Date(draft.generatedAt).toLocaleString()}</div>
                    </div>
                    <span className={`text-[11px] font-bold px-2 py-1 rounded-full ${draft.status === 'approved' ? 'bg-tertiary-container text-on-tertiary-container' : draft.status === 'rejected' ? 'bg-error-container text-error' : 'bg-secondary-container text-on-secondary-fixed'}`}>
                      {draft.status}
                    </span>
                  </div>
                  <p className="text-xs mt-2 text-on-surface-variant">{draft.explanation}</p>

                  {draft.nextBestActions && draft.nextBestActions.length > 0 && (
                    <ul className="mt-2 space-y-1 text-xs">
                      {draft.nextBestActions.map((action) => (
                        <li key={action.id} className="bg-surface-container-lowest rounded p-2">
                          <span className="font-bold">[{action.priority}] {action.label}</span>
                          <p className="text-on-surface-variant mt-1">{action.rationale}</p>
                        </li>
                      ))}
                    </ul>
                  )}

                  {draft.riskNarrative && (
                    <div className="mt-2 text-xs bg-surface-container-lowest rounded p-2 leading-relaxed">{draft.riskNarrative}</div>
                  )}

                  {draft.duplicateCandidates && (
                    <div className="mt-2 space-y-1">
                      {draft.duplicateCandidates.length === 0 ? (
                        <div className="text-xs text-on-surface-variant">No duplicate candidates detected.</div>
                      ) : draft.duplicateCandidates.map((dup) => (
                        <div key={dup.projectId} className="text-xs bg-surface-container-lowest rounded p-2">
                          <span className="font-bold">{dup.code} · {dup.title}</span>
                          <p className="text-on-surface-variant">Overlap {dup.overlapScore}% · {dup.overlapReason}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {isAdmin && draft.status === 'pending' && (
                    <div className="mt-3 flex gap-2">
                      <button onClick={() => updateDraftStatus(draft.id, 'approved')} className="text-xs px-3 py-1.5 rounded bg-tertiary-fixed-variant text-white font-bold">Approve</button>
                      <button onClick={() => updateDraftStatus(draft.id, 'rejected')} className="text-xs px-3 py-1.5 rounded bg-error text-white font-bold">Reject</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className="bg-surface-container-lowest p-8 rounded-lg shadow-sm">
            <h2 className="font-headline text-xl font-bold mb-6 flex items-center gap-2">
              <ShieldCheck className="w-6 h-6 text-primary" />
              Governance & Trust
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
              <div className="bg-surface-container-low p-4 rounded-lg">
                <p className="block text-[10px] font-bold text-on-surface-variant uppercase mb-1">Pending Approvals</p>
                <div className="flex items-center gap-3 mt-2">
                  <div className="w-6 h-6 rounded-full bg-tertiary-container flex items-center justify-center">
                    <CheckCircle2 className="w-4 h-4 text-white" />
                  </div>
                  <span className="text-xs font-bold">{pendingApprovals}</span>
                </div>
              </div>
              <div className="bg-surface-container-low p-4 rounded-lg">
                <p className="block text-[10px] font-bold text-on-surface-variant uppercase mb-1">At-risk Dependencies</p>
                <div className="flex items-center gap-3 mt-2">
                  <div className="w-6 h-6 rounded-full bg-error-container flex items-center justify-center text-error">
                    <AlertTriangle className="w-4 h-4" />
                  </div>
                  <span className="text-xs font-bold">{blockedDependencies}</span>
                </div>
              </div>
              <div className="bg-surface-container-low p-4 rounded-lg">
                <p className="block text-[10px] font-bold text-on-surface-variant uppercase mb-1">Milestones</p>
                <div className="flex items-center gap-3 mt-2">
                  <div className="w-6 h-6 rounded-full bg-primary-fixed flex items-center justify-center text-on-primary-fixed">
                    <Map className="w-4 h-4" />
                  </div>
                  <span className="text-xs font-bold">{(project.milestones ?? []).length}</span>
                </div>
              </div>
            </div>

            <div className="space-y-5">
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-xs font-bold text-on-surface-variant uppercase">Milestones by Stage</label>
                  {isAdmin && (
                    <button onClick={addMilestone} className="text-xs font-bold text-primary flex items-center gap-1">
                      <Plus className="w-3 h-3" /> Add Milestone
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  {(project.milestones ?? []).map((milestone) => (
                    <div key={milestone.id} className="grid grid-cols-1 md:grid-cols-6 xl:grid-cols-12 gap-2 bg-surface-container-low rounded-lg p-3 items-center">
                      <input
                        className="col-span-1 md:col-span-6 xl:col-span-4 bg-transparent border-b border-outline-variant py-1 text-sm outline-none"
                        value={milestone.title}
                        onChange={(e) => updateMilestone(milestone.id, { title: e.target.value })}
                        disabled={!isAdmin}
                      />
                      <select
                        className="col-span-1 md:col-span-3 xl:col-span-3 bg-surface-container rounded p-2 text-xs"
                        value={milestone.stage}
                        onChange={(e) => updateMilestone(milestone.id, { stage: e.target.value as ProjectStatus })}
                        disabled={!isAdmin}
                      >
                        <option value="Intake / Proposed">Intake / Proposed</option>
                        <option value="Scoping">Scoping</option>
                        <option value="In Progress">In Progress</option>
                        <option value="Pilot / Testing">Pilot / Testing</option>
                        <option value="Review / Approval">Review / Approval</option>
                        <option value="Launched">Launched</option>
                      </select>
                      <select
                        className="col-span-1 md:col-span-3 xl:col-span-3 bg-surface-container rounded p-2 text-xs"
                        value={milestone.status}
                        onChange={(e) => updateMilestone(milestone.id, { status: e.target.value as Milestone['status'] })}
                        disabled={!isAdmin}
                      >
                        <option value="Not Started">Not Started</option>
                        <option value="In Progress">In Progress</option>
                        <option value="Complete">Complete</option>
                        <option value="Blocked">Blocked</option>
                      </select>
                      <input
                        className="col-span-1 md:col-span-3 xl:col-span-2 bg-surface-container rounded p-2 text-xs"
                        type="date"
                        value={milestone.dueDate ?? ''}
                        onChange={(e) => updateMilestone(milestone.id, { dueDate: e.target.value })}
                        disabled={!isAdmin}
                      />
                      {isAdmin && (
                        <button className="col-span-1 md:col-span-3 xl:col-span-12 text-error text-xs font-bold xl:justify-self-end" onClick={() => removeMilestone(milestone.id)}>Remove</button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-xs font-bold text-on-surface-variant uppercase">Dependencies & Blockers</label>
                  {isAdmin && (
                    <button onClick={addDependency} className="text-xs font-bold text-primary flex items-center gap-1">
                      <Plus className="w-3 h-3" /> Add Dependency
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  {(project.dependencies ?? []).map((dependency) => (
                    <div key={dependency.id} className="grid grid-cols-1 md:grid-cols-6 xl:grid-cols-12 gap-2 bg-surface-container-low rounded-lg p-3 items-center">
                      <select
                        className="col-span-1 md:col-span-2 xl:col-span-2 bg-surface-container rounded p-2 text-xs"
                        value={dependency.type}
                        onChange={(e) => updateDependency(dependency.id, { type: e.target.value as Dependency['type'] })}
                        disabled={!isAdmin}
                      >
                        <option value="Depends On">Depends On</option>
                        <option value="Blocks">Blocks</option>
                      </select>
                      <input
                        className="col-span-1 md:col-span-6 xl:col-span-5 bg-transparent border-b border-outline-variant py-1 text-sm outline-none"
                        value={dependency.description}
                        onChange={(e) => updateDependency(dependency.id, { description: e.target.value })}
                        disabled={!isAdmin}
                      />
                      <input
                        className="col-span-1 md:col-span-3 xl:col-span-2 bg-surface-container rounded p-2 text-xs"
                        placeholder="Project code"
                        value={dependency.relatedProjectCode ?? ''}
                        onChange={(e) => updateDependency(dependency.id, { relatedProjectCode: e.target.value })}
                        disabled={!isAdmin}
                      />
                      <select
                        className="col-span-1 md:col-span-3 xl:col-span-2 bg-surface-container rounded p-2 text-xs"
                        value={dependency.status}
                        onChange={(e) => updateDependency(dependency.id, { status: e.target.value as Dependency['status'] })}
                        disabled={!isAdmin}
                      >
                        <option value="On Track">On Track</option>
                        <option value="At Risk">At Risk</option>
                        <option value="Resolved">Resolved</option>
                      </select>
                      {isAdmin && (
                        <button className="col-span-1 md:col-span-6 xl:col-span-1 text-error text-xs font-bold xl:justify-self-end" onClick={() => removeDependency(dependency.id)}>Remove</button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-on-surface-variant uppercase mb-2">Stage Approval Checkpoints</label>
                <div className="space-y-2">
                  {(project.approvalCheckpoints ?? []).map((checkpoint) => (
                    <div key={checkpoint.id} className="grid grid-cols-12 gap-2 bg-surface-container-low rounded-lg p-3 items-center">
                      <span className="col-span-12 md:col-span-3 text-xs font-bold">{checkpoint.stage}</span>
                      <input
                        className="col-span-12 md:col-span-4 bg-transparent border-b border-outline-variant py-1 text-sm outline-none"
                        value={checkpoint.name}
                        onChange={(e) => updateApproval(checkpoint.id, { name: e.target.value })}
                        disabled={!isAdmin}
                      />
                      <input
                        className="col-span-6 md:col-span-2 bg-surface-container rounded p-2 text-xs"
                        placeholder="Approver"
                        value={checkpoint.approver ?? ''}
                        onChange={(e) => updateApproval(checkpoint.id, { approver: e.target.value })}
                        disabled={!isAdmin}
                      />
                      <label className="col-span-3 md:col-span-1 text-xs flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={checkpoint.required}
                          onChange={(e) => updateApproval(checkpoint.id, { required: e.target.checked })}
                          disabled={!isAdmin}
                        />
                        Required
                      </label>
                      <label className="col-span-3 md:col-span-1 text-xs flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={checkpoint.approved}
                          onChange={(e) => updateApproval(checkpoint.id, {
                            approved: e.target.checked,
                            approvedAt: e.target.checked ? new Date().toISOString() : undefined
                          })}
                          disabled={!isAdmin}
                        />
                        Approved
                      </label>
                      <span className="col-span-6 md:col-span-1 text-[10px] text-on-surface-variant">
                        {checkpoint.approvedAt ? new Date(checkpoint.approvedAt).toLocaleDateString() : '—'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-6">
              <label className="block text-xs font-bold text-on-surface-variant uppercase mb-2">Relevant Links</label>
              <div className="space-y-2">
                <div className="flex items-center gap-3 text-sm text-primary font-medium hover:underline cursor-pointer">
                  <LinkIcon className="w-5 h-5" />
                  https://github.com/archivist/{project.code.toLowerCase()}
                </div>
                <div className="flex items-center gap-3 text-sm text-primary font-medium hover:underline cursor-pointer">
                  <FileText className="w-5 h-5" />
                  Legal Review: AI Ethics Framework.pdf
                </div>
              </div>
            </div>
          </section>
        </div>

        <div className="col-span-12 lg:col-span-4 space-y-6">
          <div className="bg-surface-container-lowest rounded-lg shadow-sm flex flex-col h-[600px]">
            <div className="p-6 border-b border-outline-variant/10">
              <h3 className="font-headline font-bold text-lg flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-primary" />
                Collaboration
              </h3>
              <p className="text-xs text-on-surface-variant mt-1">Mentions, edits, threaded replies, reactions, and attachments</p>
            </div>
            <div className="flex-1 p-6 space-y-6 overflow-y-auto">
              {comments.length === 0 && (
                <div className="text-center text-sm text-on-surface-variant mt-10">No comments yet.</div>
              )}
              {topLevelComments.map(comment => {
                const replies = repliesByParent[comment.id] ?? [];
                const canEdit = isAdmin || comment.authorId === currentUserId;
                return (
                  <div key={comment.id} className="space-y-2">
                    <div className="flex gap-3">
                      {comment.author.avatar ? (
                        <img alt={comment.author.name} className="w-8 h-8 rounded-full" src={comment.author.avatar} />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-primary-fixed flex items-center justify-center text-[10px] font-bold text-primary">{comment.author.initials}</div>
                      )}
                      <div className="bg-surface-container-low p-3 rounded-lg flex-1">
                        <div className="flex justify-between items-center mb-1 gap-2">
                          <span className="text-xs font-bold">{comment.author.name}</span>
                          <span className="text-[10px] text-on-surface-variant uppercase">
                            {new Date(comment.timestamp).toLocaleDateString()}
                          </span>
                        </div>
                        {editingCommentId === comment.id ? (
                          <div className="space-y-2">
                            <textarea
                              value={editDraft}
                              onChange={(e) => setEditDraft(e.target.value)}
                              className="w-full bg-surface-container-lowest rounded-md p-2 text-xs outline-none"
                              rows={3}
                            />
                            <div className="flex gap-2 justify-end">
                              <button className="text-[10px] font-bold" onClick={() => setEditingCommentId(null)}>Cancel</button>
                              <button className="text-[10px] font-bold text-primary" onClick={() => handleSaveEdit(comment)}>Save</button>
                            </div>
                          </div>
                        ) : (
                          <p className="text-xs text-on-surface leading-relaxed break-words">{renderRichText(comment.text)}</p>
                        )}
                        {comment.attachments && comment.attachments.length > 0 && (
                          <div className="mt-2 space-y-1">
                            {comment.attachments.map((attachment) => (
                              <a key={attachment.id} className="text-[11px] text-primary flex items-center gap-1 hover:underline" href={attachment.url} target="_blank" rel="noreferrer">
                                <Paperclip className="w-3 h-3" /> {attachment.name}
                              </a>
                            ))}
                          </div>
                        )}
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {COMMENT_REACTION_EMOJIS.map((emoji) => {
                            const count = comment.reactions?.[emoji]?.length ?? 0;
                            const isActive = Boolean(currentUserId && comment.reactions?.[emoji]?.includes(currentUserId));
                            return (
                              <button
                                key={emoji}
                                onClick={() => handleToggleReaction(comment, emoji)}
                                className={`text-[11px] px-2 py-1 rounded-full border ${isActive ? 'bg-primary/10 border-primary text-primary' : 'border-outline-variant text-on-surface-variant'}`}
                              >
                                {emoji} {count > 0 ? count : ''}
                              </button>
                            );
                          })}
                          <button onClick={() => handleToggleReaction(comment, '❤️')} className="text-[11px] text-on-surface-variant flex items-center gap-1 hover:text-primary">
                            <SmilePlus className="w-3 h-3" /> React
                          </button>
                          {canEdit && editingCommentId !== comment.id && (
                            <button onClick={() => beginEdit(comment)} className="text-[11px] text-on-surface-variant flex items-center gap-1 hover:text-primary">
                              <Pencil className="w-3 h-3" /> Edit
                            </button>
                          )}
                          {comment.editedAt && (
                            <span className="text-[10px] text-on-surface-variant">Edited {new Date(comment.editedAt).toLocaleDateString()}</span>
                          )}
                          {comment.editHistory && comment.editHistory.length > 0 && (
                            <span className="text-[10px] text-on-surface-variant">{comment.editHistory.length} edit(s)</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="ml-11 space-y-2">
                      {replies.map((reply) => (
                        <div key={reply.id} className="bg-surface-container rounded-md p-2">
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-[11px] font-bold">{reply.author.name}</span>
                            <span className="text-[10px] text-on-surface-variant">{new Date(reply.timestamp).toLocaleDateString()}</span>
                          </div>
                          <p className="text-xs break-words">{renderRichText(reply.text)}</p>
                          {reply.attachments && reply.attachments.length > 0 && (
                            <div className="mt-2 space-y-1">
                              {reply.attachments.map((attachment) => (
                                <a key={attachment.id} className="text-[11px] text-primary flex items-center gap-1 hover:underline" href={attachment.url} target="_blank" rel="noreferrer">
                                  <Paperclip className="w-3 h-3" /> {attachment.name}
                                </a>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}

                      <div className="bg-surface-container-low rounded-md p-2">
                        <div className="flex items-center gap-2 mb-2">
                          <MessageCircleReply className="w-3 h-3 text-primary" />
                          <span className="text-[11px] text-on-surface-variant">Thread reply</span>
                        </div>
                        <input
                          className="w-full bg-surface-container-lowest rounded-md p-2 text-xs outline-none"
                          placeholder="Reply in thread…"
                          value={replyDrafts[comment.id] ?? ''}
                          onChange={(e) => setReplyDrafts((prev) => ({ ...prev, [comment.id]: e.target.value }))}
                          onKeyDown={(e) => e.key === 'Enter' && handleReply(comment.id)}
                        />
                        <div className="mt-2 flex items-center justify-between">
                          <div className="flex items-center gap-2 text-[11px]">
                            <button onClick={() => setAttachmentModalTarget(comment.id)} className="text-on-surface-variant hover:text-primary flex items-center gap-1">
                              <Paperclip className="w-3 h-3" /> Attach
                            </button>
                            <span className="text-on-surface-variant">{(replyAttachments[comment.id] ?? []).length} file(s)</span>
                          </div>
                          <button onClick={() => handleReply(comment.id)} className="text-[11px] font-bold text-primary">Reply</button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="p-6 bg-surface-container-low border-t border-outline-variant/10 space-y-2">
              <div className="relative">
                <input
                  className="w-full bg-surface-container-lowest border-none rounded-lg p-3 text-sm focus:ring-2 focus:ring-primary pr-12 outline-none"
                  placeholder="Write a comment... Use @name to mention teammates"
                  type="text"
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !addingComment && handleAddComment()}
                />
                <button
                  onClick={handleAddComment}
                  disabled={addingComment}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-primary hover:bg-slate-100 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {addingComment ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-2">
                  <button onClick={() => setAttachmentModalTarget('root')} className="text-on-surface-variant hover:text-primary flex items-center gap-1">
                    <Paperclip className="w-3 h-3" /> Attach file
                  </button>
                  <span className="text-on-surface-variant">{attachments.length} attachment(s)</span>
                </div>
                <span className="text-on-surface-variant">Mentions detected: {extractMentions(newComment).length}</span>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow-sm border border-outline-variant/10">
            <label className="block text-[10px] font-bold text-on-surface-variant uppercase mb-4 tracking-widest">Project Health</label>
            <div className="space-y-4">
              <div className="flex justify-between items-center text-sm">
                <span className="text-on-surface-variant">Completion</span>
                <span className="font-bold">{project.progress}%</span>
              </div>
              <div className="w-full bg-surface-container rounded-full h-1.5 overflow-hidden">
                <div className="bg-primary h-full transition-all" style={{ width: `${project.progress}%` }}></div>
              </div>
              <div className="pt-4 space-y-3">
                <div className="flex justify-between text-xs">
                  <span className="text-on-surface-variant">Lead Archivist</span>
                  <span className="font-bold">{project.owner.name}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-on-surface-variant">Preservation Score</span>
                  <span className="text-tertiary-fixed-variant font-bold">{project.preservationScore}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-on-surface-variant">Status</span>
                  <span className="font-bold">{project.status}</span>
                </div>
              </div>
              
              <div className="mt-4 pt-4 border-t border-outline-variant/10">
                <label className="block text-xs font-bold text-on-surface-variant uppercase mb-2">Update Progress</label>
                <input 
                  type="range" 
                  min="0" 
                  max="100" 
                  value={project.progress} 
                  onChange={(e) => setProject({...project, progress: parseInt(e.target.value)})}
                  disabled={!isAdmin}
                  className="w-full accent-primary"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {isDeleteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-surface-container-lowest w-full max-w-md rounded-xl shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-outline-variant/20">
              <h3 className="font-headline text-xl font-bold text-on-surface">Delete Project?</h3>
              <p className="text-sm text-on-surface-variant mt-2">This action cannot be undone.</p>
            </div>
            <div className="p-6 bg-surface-container-low flex justify-end gap-3 border-t border-outline-variant/20">
              <button
                onClick={() => setIsDeleteModalOpen(false)}
                className="px-4 py-2 text-sm font-bold text-on-surface-variant hover:bg-surface-container-high rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="px-6 py-2 text-sm font-bold bg-error text-white rounded-lg hover:opacity-90 transition-opacity"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {attachmentModalTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-surface-container-lowest w-full max-w-lg rounded-xl shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-outline-variant/20">
              <h3 className="font-headline text-xl font-bold text-on-surface">Add Attachment</h3>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label htmlFor="attachment-url" className="block text-sm font-bold text-on-surface-variant mb-2">Attachment URL</label>
                <input
                  id="attachment-url"
                  type="url"
                  value={attachmentUrlDraft}
                  onChange={(event) => setAttachmentUrlDraft(event.target.value)}
                  placeholder="https://..."
                  className="w-full bg-surface-container-low border border-outline-variant/30 rounded-lg p-3 focus:ring-2 focus:ring-primary outline-none"
                />
              </div>
              <div>
                <label htmlFor="attachment-name" className="block text-sm font-bold text-on-surface-variant mb-2">Attachment Label (optional)</label>
                <input
                  id="attachment-name"
                  type="text"
                  value={attachmentLabelDraft}
                  onChange={(event) => setAttachmentLabelDraft(event.target.value)}
                  placeholder="Design spec"
                  className="w-full bg-surface-container-low border border-outline-variant/30 rounded-lg p-3 focus:ring-2 focus:ring-primary outline-none"
                />
              </div>
            </div>
            <div className="p-6 bg-surface-container-low flex justify-end gap-3 border-t border-outline-variant/20">
              <button
                onClick={() => {
                  setAttachmentModalTarget(null);
                  setAttachmentUrlDraft('');
                  setAttachmentLabelDraft('');
                }}
                className="px-4 py-2 text-sm font-bold text-on-surface-variant hover:bg-surface-container-high rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleAddAttachment(attachmentModalTarget)}
                className="px-6 py-2 text-sm font-bold bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
              >
                Add Attachment
              </button>
            </div>
          </div>
        </div>
      )}

      {isTagModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-surface-container-lowest w-full max-w-md rounded-xl shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-outline-variant/20">
              <h3 className="font-headline text-xl font-bold text-on-surface">Add Tag</h3>
            </div>
            <div className="p-6">
              <label htmlFor="new-tag" className="block text-sm font-bold text-on-surface-variant mb-2">Tag Name</label>
              <input
                id="new-tag"
                type="text"
                value={tagDraft}
                onChange={(event) => setTagDraft(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && handleAddTag()}
                className="w-full bg-surface-container-low border border-outline-variant/30 rounded-lg p-3 focus:ring-2 focus:ring-primary outline-none"
                placeholder="e.g., AI Safety"
              />
            </div>
            <div className="p-6 bg-surface-container-low flex justify-end gap-3 border-t border-outline-variant/20">
              <button
                onClick={() => {
                  setIsTagModalOpen(false);
                  setTagDraft('');
                }}
                className="px-4 py-2 text-sm font-bold text-on-surface-variant hover:bg-surface-container-high rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAddTag}
                className="px-6 py-2 text-sm font-bold bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
              >
                Add Tag
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
