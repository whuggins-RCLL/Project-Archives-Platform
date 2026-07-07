export const APP_CONFIG = {
  // Brand Naming
  appName: "AI Librarian Suite",
  orgName: "Your Organization",
  portalName: "Project Archives",
  subHeading: "Stakeholder Portal",
  
  // Hero Section
  heroBadge: "What We're Building",
  heroTitle: "Building What's Next for the Law Library",
  heroSubtitle: "Real projects, real progress. See how we're applying AI across research, teaching, and library operations at Stanford Law.",
  
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
