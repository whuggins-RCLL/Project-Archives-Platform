/// <reference types="vite/client" />
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

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

export const missingFirebaseConfigKeys = requiredEnvKeys.filter((key) => !import.meta.env[key]);
export const missingOptionalFirebaseConfigKeys = optionalEnvKeys.filter((key) => !import.meta.env[key]);

// 1. Try environment variables first (Vercel/GitHub)
let firebaseConfig: any = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  firestoreDatabaseId: import.meta.env.VITE_FIREBASE_DATABASE_ID || '(default)',
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
