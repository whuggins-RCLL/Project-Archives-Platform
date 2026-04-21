import { collection, doc, getDocs, getDoc, addDoc, updateDoc, deleteDoc, query, where, serverTimestamp, orderBy, onSnapshot } from 'firebase/firestore';
import { db, auth } from './firebase';
import { AdminAuditEntry, ManagedUser, Project, Comment, CommentAttachment, Metrics, OperationsDigestReport, AppRole, UserPermissionSet } from '../types';
import { buildPortfolioMetrics } from './portfolioAnalytics';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errorMessage = error instanceof Error ? error.message : 'Unknown Firestore error';
  console.error('Firestore error', {
    operationType,
    path,
    errorMessage,
  });
  throw new Error(`Failed to ${operationType} resource`);
}

const formatProjectCodeTimestamp = (date: Date): string => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const seconds = String(date.getUTCSeconds()).padStart(2, '0');

  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
};

const buildProjectCode = (timestamp: string, sequence: number): string => {
  return `AI-${timestamp}-${String(sequence).padStart(2, '0')}`;
};

const generateUniqueProjectCode = async (): Promise<string> => {
  const timestamp = formatProjectCodeTimestamp(new Date());

  for (let sequence = 0; sequence < 100; sequence++) {
    const candidate = buildProjectCode(timestamp, sequence);
    const existing = await getDocs(
      query(collection(db, 'projects'), where('code', '==', candidate))
    );

    if (existing.empty) {
      return candidate;
    }
  }

  throw new Error('Unable to generate unique project code');
};

export interface Settings {
  aiEnabled: boolean;
  activeProvider: 'gemini' | 'openai' | 'anthropic' | 'gemma' | 'groc' | 'groq';
  /** When master AI is on, controls Auto-Tag on project records. */
  aiAutoTagEnabled: boolean;
  /** When master AI is on, controls AI Summarize on project records. */
  aiSummarizeEnabled: boolean;
  aiNextBestActionEnabled: boolean;
  aiRiskNarrativeEnabled: boolean;
  aiDuplicateDetectionEnabled: boolean;
  aiRequireHumanApproval: boolean;
  privacyMode: 'public-read' | 'private-read';
  suiteName: string;
  portalName: string;
  logoDataUrl?: string;
  primaryColor: string;
  brandDarkColor: string;
  customFooter?: string;
  helpContactEmail?: string;
  googleCalendarEnabled?: boolean;
  googleCalendarId?: string;
  googleCalendarUrl?: string;
  googleCalendarTimezone?: string;
  googleDriveEnabled?: boolean;
  googleDriveId?: string;
  googleDriveUrl?: string;
  googleDriveFolderId?: string;
}

export interface IntegrationStatus {
  serviceAccountEmail: string | null;
  calendar: {
    enabled: boolean;
    calendarId: string;
    calendarUrl: string;
    timezone: string;
  };
  drive: {
    enabled: boolean;
    driveId: string;
    driveUrl: string;
    folderId: string;
  };
}

export interface CalendarTestResult {
  ok: true;
  calendarId: string;
  summary: string | null;
  timezone: string | null;
  serviceAccountEmail: string | null;
}

export interface CalendarSyncOutcome {
  projectId: string;
  code: string;
  title: string;
  action: 'created' | 'updated' | 'skipped-no-date' | 'skipped-invalid-date' | 'failed';
  eventId?: string;
  htmlLink?: string;
  message?: string;
}

export interface CalendarSyncReport {
  calendarId: string;
  totals: { evaluated: number; created: number; updated: number; skipped: number; failed: number };
  outcomes: CalendarSyncOutcome[];
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  modifiedTime?: string;
  size?: string;
  webViewLink?: string;
  iconLink?: string;
  trashed?: boolean;
  owners?: Array<{ displayName?: string; emailAddress?: string }>;
}

export interface DriveFileMetadataInput {
  name?: string;
  mimeType?: string;
  description?: string;
  parents?: string[];
  properties?: Record<string, string>;
  appProperties?: Record<string, string>;
  starred?: boolean;
}


export interface AddCommentOptions {
  parentId?: string;
  mentions?: string[];
  attachments?: CommentAttachment[];
}

export const api = {
  getCurrentUserMirrorRole: async (): Promise<AppRole | null> => {
    const mirror = await api.getCurrentUserMirrorSnapshot();
    return mirror?.role ?? null;
  },

  /** Single read of `users/{uid}` for role resolution and permission merge (matches Firestore rules inputs). */
  getCurrentUserMirrorSnapshot: async (): Promise<{ role: AppRole; permissions?: UserPermissionSet } | null> => {
    const currentUser = auth.currentUser;
    if (!currentUser?.uid) return null;
    try {
      const userRef = doc(db, 'users', currentUser.uid);
      const snap = await getDoc(userRef);
      if (!snap.exists()) return null;
      const data = snap.data();
      const role = data?.role;
      if (role === 'owner' || role === 'admin' || role === 'collaborator' || role === 'viewer') {
        return { role, permissions: data?.permissions as UserPermissionSet | undefined };
      }
      return null;
    } catch {
      return null;
    }
  },

  getElevatedAuthStatus: async (): Promise<{ required: boolean; needsChange: boolean }> => {
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error('You must be logged in.');
    const idToken = await currentUser.getIdToken();
    const response = await fetch('/api/auth/elevated/status', {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Unable to read elevated auth status');
    return {
      required: payload.required === true,
      needsChange: payload.needsChange === true,
    };
  },

  loginElevatedAccess: async (password: string): Promise<{ needsChange: boolean }> => {
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error('You must be logged in.');
    const idToken = await currentUser.getIdToken();
    const response = await fetch('/api/auth/elevated/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ password }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Invalid elevated access password');
    return { needsChange: payload.needsChange === true };
  },

  changeElevatedPassword: async (currentPassword: string, newPassword: string): Promise<void> => {
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error('You must be logged in.');
    const idToken = await currentUser.getIdToken();
    const response = await fetch('/api/auth/elevated/change-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Unable to update elevated access password');
  },

  refreshCurrentUserClaims: async (forceRefresh = true): Promise<void> => {
    if (!auth.currentUser) throw new Error('You must be logged in to refresh claims.');
    await auth.currentUser.getIdTokenResult(forceRefresh);
  },

  reconcileRole: async (): Promise<{ role: AppRole; reconciled: boolean }> => {
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error('You must be logged in to reconcile role.');
    const idToken = await currentUser.getIdToken();
    const response = await fetch('/api/auth/reconcile-role', {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}` },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Failed to reconcile role');
    const role = payload.role === 'owner' || payload.role === 'admin' || payload.role === 'collaborator' || payload.role === 'viewer'
      ? payload.role
      : 'viewer';
    return { role, reconciled: payload.reconciled === true };
  },

  getSettings: async (): Promise<Settings> => {
    try {
      const docRef = doc(db, 'settings', 'global');
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const data = docSnap.data() as Partial<Settings>;
        const aiEnabled = data.aiEnabled ?? false;
        return {
          aiEnabled,
          activeProvider: data.activeProvider ?? 'gemini',
          aiAutoTagEnabled: data.aiAutoTagEnabled ?? aiEnabled,
          aiSummarizeEnabled: data.aiSummarizeEnabled ?? aiEnabled,
          aiNextBestActionEnabled: data.aiNextBestActionEnabled ?? true,
          aiRiskNarrativeEnabled: data.aiRiskNarrativeEnabled ?? true,
          aiDuplicateDetectionEnabled: data.aiDuplicateDetectionEnabled ?? true,
          aiRequireHumanApproval: data.aiRequireHumanApproval ?? true,
          privacyMode: data.privacyMode ?? 'public-read',
          suiteName: data.suiteName ?? 'AI Librarian Suite',
          portalName: data.portalName ?? 'Project Archives',
          logoDataUrl: data.logoDataUrl ?? '',
          primaryColor: data.primaryColor ?? '#002045',
          brandDarkColor: data.brandDarkColor ?? '#1A365D',
          customFooter: data.customFooter ?? '',
          helpContactEmail: data.helpContactEmail ?? '',
          googleCalendarEnabled: data.googleCalendarEnabled ?? false,
          googleCalendarId: data.googleCalendarId ?? '',
          googleCalendarUrl: data.googleCalendarUrl ?? '',
          googleCalendarTimezone: data.googleCalendarTimezone ?? '',
          googleDriveEnabled: data.googleDriveEnabled ?? false,
          googleDriveId: data.googleDriveId ?? '',
          googleDriveUrl: data.googleDriveUrl ?? '',
          googleDriveFolderId: data.googleDriveFolderId ?? '',
        };
      }
      return {
        aiEnabled: false,
        activeProvider: 'gemini',
        aiAutoTagEnabled: false,
        aiSummarizeEnabled: false,
        aiNextBestActionEnabled: true,
        aiRiskNarrativeEnabled: true,
        aiDuplicateDetectionEnabled: true,
        aiRequireHumanApproval: true,
        privacyMode: 'public-read',
        suiteName: 'AI Librarian Suite',
        portalName: 'Project Archives',
        logoDataUrl: '',
        primaryColor: '#002045',
        brandDarkColor: '#1A365D',
        customFooter: '',
        helpContactEmail: '',
        googleCalendarEnabled: false,
        googleCalendarId: '',
        googleCalendarUrl: '',
        googleCalendarTimezone: '',
        googleDriveEnabled: false,
        googleDriveId: '',
        googleDriveUrl: '',
        googleDriveFolderId: '',
      };
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, 'settings/global');
    }
  },

  updateSettings: async (settings: Settings): Promise<void> => {
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        throw new Error('You must be logged in to update settings.');
      }

      const idToken = await currentUser.getIdToken();
      const response = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify(settings),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Settings update failed');
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'settings/global');
    }
  },

  generateAI: async (
    prompt: string,
    provider: string,
    model: string,
    systemInstruction?: string,
    feature?: 'autoTag' | 'summarize' | 'nextBestAction' | 'riskNarrative',
  ): Promise<string> => {
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        throw new Error('You must be logged in to use AI features.');
      }

      const idToken = await currentUser.getIdToken();
      const response = await fetch('/api/ai/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ prompt, provider, model, systemInstruction, feature })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'AI request failed');
      }

      const data = await response.json();
      return data.text;
    } catch (error) {
      console.error('AI generation request failed');
      throw error;
    }
  },

  subscribeToProjects: (callback: (projects: Project[]) => void, onError: (error: unknown) => void) => {
    const q = query(collection(db, 'projects'), orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snapshot) => {
      callback(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)));
    }, (error) => {
      onError(error);
    });
  },

  getProjects: async (): Promise<Project[]> => {
    try {
      const q = query(collection(db, 'projects'), orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project));
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, 'projects');
    }
  },

  createProject: async (project: Omit<Project, 'id' | 'code'>): Promise<Project> => {
    try {
      const generatedCode = await generateUniqueProjectCode();
      const newProjectData = {
        ...project,
        code: generatedCode,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };
      const docRef = await addDoc(collection(db, 'projects'), newProjectData);
      return { id: docRef.id, ...newProjectData } as unknown as Project;
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'projects');
    }
  },

  updateProject: async (id: string, updates: Partial<Project>): Promise<Project> => {
    try {
      const docRef = doc(db, 'projects', id);
      const updateData = { ...updates, updatedAt: serverTimestamp() };
      await updateDoc(docRef, updateData);
      const updatedDoc = await getDoc(docRef);
      return { id: updatedDoc.id, ...updatedDoc.data() } as Project;
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `projects/${id}`);
    }
  },

  deleteProject: async (id: string): Promise<void> => {
    try {
      await deleteDoc(doc(db, 'projects', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `projects/${id}`);
    }
  },

  subscribeToComments: (projectId: string, callback: (comments: Comment[]) => void, onError: (error: unknown) => void) => {
    const q = query(collection(db, 'comments'), where('projectId', '==', projectId), orderBy('timestamp', 'asc'));
    return onSnapshot(q, (snapshot) => {
      callback(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Comment)));
    }, (error) => {
      onError(error);
    });
  },

  getComments: async (projectId: string): Promise<Comment[]> => {
    try {
      const q = query(collection(db, 'comments'), where('projectId', '==', projectId), orderBy('timestamp', 'asc'));
      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Comment));
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, 'comments');
    }
  },

  addComment: async (projectId: string, text: string, options: AddCommentOptions = {}): Promise<Comment> => {
    try {
      if (!auth.currentUser?.uid) {
        throw new Error('You must be logged in to add comments');
      }

      const sanitizedMentions = (options.mentions ?? []).slice(0, 20);
      const sanitizedAttachments = (options.attachments ?? []).slice(0, 5);

      const newComment: Omit<Comment, 'id'> & { createdAt: unknown } = {
        projectId,
        authorId: auth.currentUser.uid,
        author: {
          name: auth.currentUser.displayName || 'Current User',
          initials: auth.currentUser.displayName?.substring(0, 2).toUpperCase() || 'CU'
        },
        text,
        timestamp: new Date().toISOString(),
        mentions: sanitizedMentions,
        reactions: {},
        attachments: sanitizedAttachments,
        parentId: options.parentId,
        editHistory: [],
        createdAt: serverTimestamp()
      };
      const docRef = await addDoc(collection(db, 'comments'), newComment);
      return { id: docRef.id, ...newComment } as Comment;
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'comments');
    }
  },

  updateCommentText: async (comment: Comment, nextText: string): Promise<void> => {
    try {
      if (!auth.currentUser?.uid) {
        throw new Error('You must be logged in to edit comments');
      }

      const docRef = doc(db, 'comments', comment.id);
      const editHistory = [
        ...(comment.editHistory ?? []),
        {
          text: comment.text,
          editedAt: new Date().toISOString(),
          editorId: auth.currentUser.uid,
        }
      ].slice(-20);

      await updateDoc(docRef, {
        text: nextText,
        mentions: Array.from(new Set((nextText.match(/@[\w.-]+/g) ?? []).map(token => token.slice(1)))).slice(0, 20),
        editedAt: new Date().toISOString(),
        editHistory,
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `comments/${comment.id}`);
    }
  },

  toggleCommentReaction: async (comment: Comment, emoji: string): Promise<void> => {
    try {
      if (!auth.currentUser?.uid) {
        throw new Error('You must be logged in to react to comments');
      }

      const uid = auth.currentUser.uid;
      const currentReactions = comment.reactions ?? {};
      const currentUsers = currentReactions[emoji] ?? [];
      const nextUsers = currentUsers.includes(uid)
        ? currentUsers.filter(userId => userId !== uid)
        : [...currentUsers, uid];

      const nextReactions: Record<string, string[]> = { ...currentReactions };
      if (nextUsers.length === 0) {
        delete nextReactions[emoji];
      } else {
        nextReactions[emoji] = nextUsers.slice(0, 100);
      }

      await updateDoc(doc(db, 'comments', comment.id), { reactions: nextReactions });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `comments/${comment.id}/reactions`);
    }
  },

  getCurrentUserId: (): string | null => auth.currentUser?.uid ?? null,

  logSuiteAction: async (action: string, details: Record<string, unknown>): Promise<void> => {
    try {
      await addDoc(collection(db, 'suiteActions'), {
        action,
        details,
        createdAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'suiteActions');
    }
  },

  getMetrics: async (): Promise<Metrics> => {
    try {
      const snapshot = await getDocs(collection(db, 'projects'));
      const projects = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project));
      return buildPortfolioMetrics(projects);
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, 'projects');
    }
  },

  runOperationsDigest: async (): Promise<OperationsDigestReport> => {
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        throw new Error('You must be logged in to run operations digest.');
      }

      const idToken = await currentUser.getIdToken();
      const response = await fetch('/api/admin/operations/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ channel: 'weekly_digest' }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Operations digest failed');
      }

      return await response.json() as OperationsDigestReport;
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'admin/operations/run');
    }
  },

  listManagedUsers: async (): Promise<ManagedUser[]> => {
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error('You must be logged in to list users.');
    const idToken = await currentUser.getIdToken();
    const response = await fetch('/api/admin/users/list', {
      method: 'GET',
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to list users');
    }
    const data = await response.json() as { users: ManagedUser[] };
    return data.users;
  },

  listRoleAuditLogs: async (): Promise<AdminAuditEntry[]> => {
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error('You must be logged in to view audit logs.');
    const idToken = await currentUser.getIdToken();
    const response = await fetch('/api/admin/users/audit', {
      method: 'GET',
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to list audit logs');
    }
    const data = await response.json() as { audit: AdminAuditEntry[] };
    return data.audit;
  },

  setUserRole: async (uid: string, role: AppRole): Promise<string> => {
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error('You must be logged in to manage roles.');
    const idToken = await currentUser.getIdToken();
    const response = await fetch('/api/admin/users/set-role', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ uid, role }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Failed to set role');
    return payload.message || 'Role updated';
  },

  setUserStatus: async (uid: string, action: 'disable' | 'enable'): Promise<string> => {
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error('You must be logged in to manage users.');
    const idToken = await currentUser.getIdToken();
    const response = await fetch(`/api/admin/users/${action}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ uid }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Failed to ${action} user`);
    return payload.message || `User ${action}d`;
  },

  setUserPermissions: async (uid: string, permissions: UserPermissionSet): Promise<string> => {
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error('You must be logged in to manage permissions.');
    const idToken = await currentUser.getIdToken();
    const response = await fetch('/api/admin/users/set-permissions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ uid, permissions }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Failed to update permissions');
    return payload.message || 'Permissions updated';
  },

  getOwnerBootstrapStatus: async (): Promise<{ ownerCount: number; configured: boolean; eligible: boolean }> => {
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error('You must be logged in to view owner bootstrap status.');
    const idToken = await currentUser.getIdToken();
    const response = await fetch('/api/admin/bootstrap/status', {
      method: 'GET',
      headers: { Authorization: `Bearer ${idToken}` },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Failed to get owner bootstrap status');
    return {
      ownerCount: typeof payload.ownerCount === 'number' ? payload.ownerCount : 0,
      configured: payload.configured === true,
      eligible: payload.eligible === true,
    };
  },

  claimInitialOwnerAccess: async (): Promise<{ message: string }> => {
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error('You must be logged in to claim owner access.');
    const idToken = await currentUser.getIdToken();
    const response = await fetch('/api/admin/bootstrap/claim', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({}),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Failed to claim owner access');
    return { message: payload.message || 'Owner access granted.' };
  },

  getIntegrationStatus: async (): Promise<IntegrationStatus> => {
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error('You must be logged in.');
    const idToken = await currentUser.getIdToken();
    const response = await fetch('/api/admin/integrations/status', {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Failed to read integration status');
    return payload as IntegrationStatus;
  },

  testGoogleCalendar: async (): Promise<CalendarTestResult> => {
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error('You must be logged in.');
    const idToken = await currentUser.getIdToken();
    const response = await fetch('/api/admin/calendar/test', {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}` },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Unable to reach the Google Calendar');
    return payload as CalendarTestResult;
  },

  syncProjectsToCalendar: async (options: { projectId?: string } = {}): Promise<CalendarSyncReport> => {
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error('You must be logged in.');
    const idToken = await currentUser.getIdToken();
    const response = await fetch('/api/admin/calendar/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(options),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Unable to sync calendar');
    return payload as CalendarSyncReport;
  },

  listDriveFiles: async (options: { pageToken?: string; pageSize?: number; q?: string; folderId?: string } = {}): Promise<{ files: DriveFile[]; nextPageToken: string | null }> => {
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error('You must be logged in.');
    const idToken = await currentUser.getIdToken();
    const params = new URLSearchParams();
    if (options.pageToken) params.set('pageToken', options.pageToken);
    if (options.pageSize) params.set('pageSize', String(options.pageSize));
    if (options.q) params.set('q', options.q);
    if (options.folderId) params.set('folderId', options.folderId);
    const response = await fetch(`/api/admin/drive/files?${params.toString()}`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Unable to list drive files');
    return payload as { files: DriveFile[]; nextPageToken: string | null };
  },

  getDriveFile: async (fileId: string): Promise<DriveFile> => {
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error('You must be logged in.');
    const idToken = await currentUser.getIdToken();
    const response = await fetch(`/api/admin/drive/files/${encodeURIComponent(fileId)}`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Unable to get drive file');
    return payload as DriveFile;
  },

  downloadDriveFile: async (fileId: string): Promise<Blob> => {
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error('You must be logged in.');
    const idToken = await currentUser.getIdToken();
    const response = await fetch(`/api/admin/drive/files/${encodeURIComponent(fileId)}?alt=media`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || 'Unable to download drive file');
    }
    return response.blob();
  },

  createDriveFile: async (
    metadata: DriveFileMetadataInput,
    content?: { base64: string; mimeType: string },
  ): Promise<DriveFile> => {
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error('You must be logged in.');
    const idToken = await currentUser.getIdToken();
    const response = await fetch('/api/admin/drive/files', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        metadata,
        contentBase64: content?.base64,
        contentMimeType: content?.mimeType,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Unable to create drive file');
    return payload as DriveFile;
  },

  updateDriveFile: async (
    fileId: string,
    options: {
      metadata?: DriveFileMetadataInput;
      addParents?: string;
      removeParents?: string;
      content?: { base64: string; mimeType: string };
    },
  ): Promise<DriveFile> => {
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error('You must be logged in.');
    const idToken = await currentUser.getIdToken();
    const response = await fetch(`/api/admin/drive/files/${encodeURIComponent(fileId)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        metadata: options.metadata,
        addParents: options.addParents,
        removeParents: options.removeParents,
        contentBase64: options.content?.base64,
        contentMimeType: options.content?.mimeType,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Unable to update drive file');
    return payload as DriveFile;
  },

  deleteDriveFile: async (fileId: string): Promise<void> => {
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error('You must be logged in.');
    const idToken = await currentUser.getIdToken();
    const response = await fetch(`/api/admin/drive/files/${encodeURIComponent(fileId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (response.status === 204) return;
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || 'Unable to delete drive file');
    }
  },
};
