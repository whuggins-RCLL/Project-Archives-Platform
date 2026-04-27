import { ApprovalCheckpoint, Milestone, Project, PROJECT_STAGE_SEQUENCE } from '../types';

function stageIdPrefix(stage: string): string {
  return stage.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

export function buildDefaultMilestones(): Milestone[] {
  const defaultStage = PROJECT_STAGE_SEQUENCE[0];
  return [
    {
      id: 'ms-1',
      title: `${defaultStage} milestone`,
      stage: defaultStage,
      status: 'In Progress'
    }
  ];
}

export function buildDefaultApprovalCheckpoints(): ApprovalCheckpoint[] {
  const defaultStage = PROJECT_STAGE_SEQUENCE[0];
  return [
    {
      id: `ap-${stageIdPrefix(defaultStage)}`,
      stage: defaultStage,
      name: `${defaultStage} gate approval`,
      required: true,
      approved: false
    }
  ];
}

export function withGovernanceDefaults(project: Project): Project {
  return {
    ...project,
    milestones: project.milestones ?? buildDefaultMilestones(),
    dependencies: project.dependencies ?? [],
    approvalCheckpoints: project.approvalCheckpoints ?? buildDefaultApprovalCheckpoints(),
    aiDrafts: project.aiDrafts ?? []
  };
}
