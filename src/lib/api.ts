import { collection, doc, getDocs, getDoc, addDoc, updateDoc, deleteDoc, query, where, serverTimestamp, orderBy, onSnapshot } from 'firebase/firestore';
import { db, auth } from './firebase';
import { Project, Comment, CommentAttachment, Metrics, OperationsDigestReport } from '../types';
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
  activeProvider: string;
  aiNextBestActionEnabled: boolean;
  aiRiskNarrativeEnabled: boolean;
  aiDuplicateDetectionEnabled: boolean;
  aiRequireHumanApproval: boolean;
  privacyMode: 'public-read' | 'private-read';
}


export interface AddCommentOptions {
  parentId?: string;
  mentions?: string[];
  attachments?: CommentAttachment[];
}

export const api = {
  getSettings: async (): Promise<Settings> => {
    try {
      const docRef = doc(db, 'settings', 'global');
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const data = docSnap.data() as Partial<Settings>;
        return {
          aiEnabled: data.aiEnabled ?? false,
          activeProvider: data.activeProvider ?? 'gemini',
          aiNextBestActionEnabled: data.aiNextBestActionEnabled ?? true,
          aiRiskNarrativeEnabled: data.aiRiskNarrativeEnabled ?? true,
          aiDuplicateDetectionEnabled: data.aiDuplicateDetectionEnabled ?? true,
          aiRequireHumanApproval: data.aiRequireHumanApproval ?? true,
          privacyMode: data.privacyMode ?? 'public-read'
        };
      }
      return {
        aiEnabled: false,
        activeProvider: 'gemini',
        aiNextBestActionEnabled: true,
        aiRiskNarrativeEnabled: true,
        aiDuplicateDetectionEnabled: true,
        aiRequireHumanApproval: true,
        privacyMode: 'public-read'
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

  generateAI: async (prompt: string, provider: string, model: string, systemInstruction?: string): Promise<string> => {
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
        body: JSON.stringify({ prompt, provider, model, systemInstruction })
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
  }
};
