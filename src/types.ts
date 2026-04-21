export type ProjectStatus = 'Intake / Proposed' | 'Scoping' | 'In Progress' | 'Pilot / Testing' | 'Review / Approval' | 'Launched';
export type ProjectPriority = 'Low' | 'Medium' | 'High';
export type MilestoneStatus = 'Not Started' | 'In Progress' | 'Complete' | 'Blocked';
export type DependencyType = 'Depends On' | 'Blocks';
export type DependencyStatus = 'On Track' | 'At Risk' | 'Resolved';

export const PROJECT_STAGE_SEQUENCE: ProjectStatus[] = [
  'Intake / Proposed',
  'Scoping',
  'In Progress',
  'Pilot / Testing',
  'Review / Approval',
  'Launched'
];

export interface Milestone {
  id: string;
  title: string;
  stage: ProjectStatus;
  dueDate?: string;
  status: MilestoneStatus;
  owner?: string;
  notes?: string;
}

export interface Dependency {
  id: string;
  type: DependencyType;
  description: string;
  relatedProjectCode?: string;
  status: DependencyStatus;
  owner?: string;
  targetDate?: string;
}

export interface AIModelOption {
  id: string;
  label: string;
  description: string;
  provider: 'gemini' | 'openai' | 'anthropic' | 'gemma' | 'groc' | 'groq';
}

export interface ApprovalCheckpoint {
  id: string;
  stage: ProjectStatus;
  name: string;
  required: boolean;
  approved: boolean;
  approver?: string;
  approvedAt?: string;
  notes?: string;
}

export type AIDraftType = 'nextBestAction' | 'riskNarrative' | 'duplicateDetection';
export type AIDraftApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface AIDraftRecommendation {
  id: string;
  label: string;
  rationale: string;
  priority: 'Low' | 'Medium' | 'High';
}

export interface AIDuplicateCandidate {
  projectId: string;
  code: string;
  title: string;
  overlapScore: number;
  overlapReason: string;
}

export interface AIDraft {
  id: string;
  type: AIDraftType;
  generatedAt: string;
  generatedBy?: string;
  confidence: number;
  explanation: string;
  status: AIDraftApprovalStatus;
  approvedAt?: string;
  approvedBy?: string;
  rejectedAt?: string;
  rejectedBy?: string;
  nextBestActions?: AIDraftRecommendation[];
  riskNarrative?: string;
  duplicateCandidates?: AIDuplicateCandidate[];
}

export interface Project {
  id: string;
  code: string;
  title: string;
  description: string;
  status: ProjectStatus;
  priority: ProjectPriority;
  owner: { name: string; initials: string; avatar?: string; group?: string };
  tags: string[];
  progress: number;
  department: string;
  preservationScore: number;
  riskFactor: string;
  milestones?: Milestone[];
  dependencies?: Dependency[];
  approvalCheckpoints?: ApprovalCheckpoint[];
  aiDrafts?: AIDraft[];
  dueDate?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface CommentAttachment {
  id: string;
  name: string;
  url: string;
  mimeType?: string;
}

export interface CommentEditHistoryEntry {
  text: string;
  editedAt: string;
  editorId: string;
}

export interface Comment {
  id: string;
  projectId: string;
  authorId: string;
  author: { name: string; avatar?: string; initials: string };
  text: string;
  timestamp: string;
  parentId?: string;
  mentions?: string[];
  reactions?: Record<string, string[]>;
  attachments?: CommentAttachment[];
  editedAt?: string;
  editHistory?: CommentEditHistoryEntry[];
}

export interface Metrics {
  totalRecords: number;
  riskLevel: string;
  activeProjects: number;
  projectsByStatus: Record<ProjectStatus, number>;
  criticalMilestonesPending: number;
  slaBreaches: number;
  averageProjectAgeDays: number;
  intakeTrendPercent: number;
  baselineLabel: string;
}

export interface OperationsProjectSignal {
  projectId: string;
  code: string;
  title: string;
  status: ProjectStatus;
  ownerName: string;
  daysLate?: number;
  daysDormant?: number;
  stageAgeDays?: number;
  stageTargetDays?: number;
}

export interface OperationsDigestReport {
  generatedAt: string;
  totals: {
    projectsEvaluated: number;
    slaAlerts: number;
    dormantProjects: number;
    overdueStages: number;
  };
  alerts: {
    slaAlerts: OperationsProjectSignal[];
    dormantProjects: OperationsProjectSignal[];
    overdueStages: OperationsProjectSignal[];
  };
  summaryLines: string[];
  delivery: {
    slack: 'sent' | 'skipped' | 'failed';
    email: 'sent' | 'skipped' | 'failed';
  };
}

export type UserStatus = 'active' | 'disabled';
export type AppRole = 'owner' | 'admin' | 'collaborator' | 'viewer';
export type UserPermissionKey = 'canManageRoles' | 'canManageSettings' | 'canEditContent' | 'canViewInternalStats';

export interface UserPermissionSet {
  canManageRoles: boolean;
  canManageSettings: boolean;
  canEditContent: boolean;
  canViewInternalStats: boolean;
}

export interface ManagedUser {
  uid: string;
  email: string;
  displayName: string;
  role: AppRole;
  permissions?: UserPermissionSet;
  status: UserStatus;
  createdAt?: string;
  updatedAt?: string;
  lastRoleChangedAt?: string;
  lastRoleChangedBy?: string;
}

export interface AdminAuditEntry {
  id: string;
  actorUid: string;
  actorEmail: string;
  targetUid: string;
  targetEmail: string;
  action: string;
  oldRole?: AppRole;
  newRole?: AppRole;
  timestamp: string;
  metadata?: Record<string, unknown>;
}
