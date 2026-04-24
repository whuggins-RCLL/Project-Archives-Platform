export const APP_CONFIG = {
  // Brand Naming
  appName: "AI Librarian Suite",
  orgName: "Stanford Law Library",
  portalName: "Project Archives",
  subHeading: "Stakeholder Portal",
  
  // Hero Section
  heroTitle: "Advancing the Library through AI Innovation",
  heroSubtitle: "Track our progress as we transform archival workflows, enhance search capabilities, and build the next generation of library services.",
  
  // Footer
  footerText: "AI Librarian Suite. All rights reserved.",
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
