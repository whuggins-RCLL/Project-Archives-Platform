/// <reference types="vite/client" />
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

type RuntimeFirebaseEnv = Partial<Record<string, string>>;

declare global {
  interface Window {
    __APP_ENV__?: RuntimeFirebaseEnv;
  }
}

const getFirebaseEnvValue = (key: string): string | undefined => {
  const viteValue = import.meta.env[key];
  if (typeof viteValue === 'string' && viteValue.trim().length > 0) {
    return viteValue;
  }

  if (typeof window !== 'undefined') {
    const runtimeValue = window.__APP_ENV__?.[key];
    if (typeof runtimeValue === 'string' && runtimeValue.trim().length > 0) {
      return runtimeValue;
    }
  }

  return undefined;
};

const requiredEnvKeys = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_APP_ID',
] as const;

const optionalEnvKeys = [
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
] as const;

export const missingFirebaseConfigKeys = requiredEnvKeys.filter((key) => !getFirebaseEnvValue(key));
export const missingOptionalFirebaseConfigKeys = optionalEnvKeys.filter((key) => !getFirebaseEnvValue(key));

// 1. Try environment variables first (Vercel/GitHub)
let firebaseConfig: any = {
  apiKey: getFirebaseEnvValue('VITE_FIREBASE_API_KEY'),
  authDomain: getFirebaseEnvValue('VITE_FIREBASE_AUTH_DOMAIN'),
  projectId: getFirebaseEnvValue('VITE_FIREBASE_PROJECT_ID'),
  storageBucket: getFirebaseEnvValue('VITE_FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: getFirebaseEnvValue('VITE_FIREBASE_MESSAGING_SENDER_ID'),
  appId: getFirebaseEnvValue('VITE_FIREBASE_APP_ID'),
  firestoreDatabaseId: getFirebaseEnvValue('VITE_FIREBASE_DATABASE_ID') || '(default)',
};
let resolvedFromLocalConfig = false;

// 2. Fallback to local config file (AI Studio)
if (!firebaseConfig.apiKey) {
  const configModules = import.meta.glob('../../firebase-applet-config.json', { eager: true });
  const moduleKeys = Object.keys(configModules);
  if (moduleKeys.length > 0) {
    firebaseConfig = (configModules[moduleKeys[0]] as any).default || configModules[moduleKeys[0]];
    resolvedFromLocalConfig = true;
  } else {
    console.error("Firebase configuration missing. Please set VITE_FIREBASE_* environment variables.");
    firebaseConfig = {
      apiKey: 'missing-api-key',
      authDomain: 'missing-auth-domain',
      projectId: 'missing-project-id',
      storageBucket: 'missing-storage-bucket',
      messagingSenderId: 'missing-messaging-sender-id',
      appId: 'missing-app-id',
      firestoreDatabaseId: '(default)',
    };
  }
}

export const isFirebaseConfigured = missingFirebaseConfigKeys.length === 0 || resolvedFromLocalConfig;

if (missingOptionalFirebaseConfigKeys.length > 0) {
  console.warn(
    `Firebase optional environment variables are missing: ${missingOptionalFirebaseConfigKeys.join(', ')}. Continuing without them.`,
  );
}

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const storage = getStorage(app);
