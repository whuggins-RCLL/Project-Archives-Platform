export const APP_CONFIG = {
  // Brand Naming
  appName: "SLS AI Social",
  orgName: "Stanford Law School",
  portalName: "SLS AI Social",
  subHeading: "Community AI Exchange",
  
  // Hero Section
  heroTitle: "SLS AI Social",
  heroSubtitle: "A private Stanford Law School space for students, faculty, and staff to share practical AI ideas, prompts, projects, and conversations.",
  
  // Footer
  footerText: "SLS AI Social. All rights reserved.",
};

const normalizeBaseUrl = (value: string | undefined): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
};

export const INTEGRATION_CONFIG = {
  githubBaseUrl: normalizeBaseUrl(import.meta.env.VITE_PROJECT_GITHUB_BASE_URL),
  googleDriveFolderBaseUrl: normalizeBaseUrl(import.meta.env.VITE_PROJECT_DRIVE_FOLDER_BASE_URL),
};
