import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { readFile } from "node:fs/promises";
import { createSign, randomUUID, createHash, timingSafeEqual } from "node:crypto";
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import admin from "firebase-admin";

dotenv.config();

const isProduction = process.env.NODE_ENV === "production";
const isVercel = Boolean(process.env.VERCEL);
const PORT = 3000;
const app = express();

let adminAuth: admin.auth.Auth | null = null;
let adminSdkInitError: string | null = null;

function sanitizeServiceAccountJson(raw: string): string {
  let s = raw.trim();
  // Strip surrounding single or double quotes that are sometimes added by env var tools
  if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  console.warn("FIREBASE_SERVICE_ACCOUNT_JSON not set; trying Application Default Credentials.");
  try {
    if (admin.apps.length === 0) {
      admin.initializeApp();
    }
    adminAuth = admin.auth();
    console.log("Firebase Admin SDK initialized via Application Default Credentials");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    adminSdkInitError = `ADC failed: ${msg}`;
    console.warn("Firebase Admin SDK: ADC initialization failed. Admin features will be unavailable.", error);
  }
} else {
  try {
    const raw = sanitizeServiceAccountJson(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    const sa = JSON.parse(raw) as {
      project_id?: string;
      client_email?: string;
      private_key?: string;
    };
    if (!sa.project_id || !sa.client_email || !sa.private_key) {
      throw new Error("Service account JSON is missing required project_id/client_email/private_key fields");
    }
    if (admin.apps.length === 0) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: sa.project_id,
          clientEmail: sa.client_email,
          privateKey: sa.private_key.replace(/\\n/g, "\n"),
        }),
      });
    }
    adminAuth = admin.auth();
    console.log("Firebase Admin SDK initialized");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    adminSdkInitError = `Service account init failed: ${msg}`;
    console.error("Failed to initialize Firebase Admin SDK:", error);
    // Fallback: try ADC in case this is a GCP environment with ambient credentials
    try {
      if (admin.apps.length === 0) {
        admin.initializeApp();
      }
      adminAuth = admin.auth();
      adminSdkInitError = null;
      console.log("Firebase Admin SDK initialized via ADC fallback");
    } catch {
      // ADC also unavailable; admin features will be degraded
    }
  }
}

const ALLOWED_PROVIDERS = new Set(["gemini", "openai", "anthropic", "gemma", "groc", "groq"]);
const DEFAULT_GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const AI_FEATURE_KEYS = new Set(["autoTag", "summarize", "nextBestAction", "riskNarrative"]);
const AI_RATE_LIMIT_WINDOW_MS = 60_000;
const AI_RATE_LIMIT_MAX_REQUESTS = 20;
const allowedOrigins = getAllowedCorsOrigins();
const devOrigins = ["http://localhost:3000", "http://127.0.0.1:3000"];
const ADMIN_SETTINGS_RATE_LIMIT_WINDOW_MS = 60_000;
const ADMIN_SETTINGS_RATE_LIMIT_MAX_REQUESTS = 15;
const ADMIN_OPERATIONS_RATE_LIMIT_WINDOW_MS = 60_000;
const ADMIN_OPERATIONS_RATE_LIMIT_MAX_REQUESTS = 6;
/**
 * Settings payloads include an optional `logoDataUrl` that validateSettings allows up to ~150 KB.
 * Keep headroom above `express.json` limit so base64 logos do not trigger a 413 on save.
 */
const ADMIN_SETTINGS_MAX_BODY_BYTES = 256 * 1024;
const ADMIN_OPERATIONS_MAX_BODY_BYTES = 2 * 1024;
const ADMIN_SETTINGS_TIMEOUT_MS = 8_000;
const ADMIN_OPERATIONS_TIMEOUT_MS = 15_000;
const MAX_PROMPT_LENGTH = 4_000;
const MAX_SYSTEM_INSTRUCTION_LENGTH = 2_000;
const INTEGRATIONS_TIMEOUT_MS = 15_000;
const INTEGRATIONS_RATE_LIMIT_WINDOW_MS = 60_000;
const INTEGRATIONS_RATE_LIMIT_MAX_REQUESTS = 30;
const DRIVE_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
const DRIVE_METADATA_MAX_BYTES = 8 * 1024;
const GOOGLE_SCOPE_CALENDAR = "https://www.googleapis.com/auth/calendar";
const GOOGLE_SCOPE_DRIVE = "https://www.googleapis.com/auth/drive";
const GOOGLE_CALENDAR_ID_MAX_LENGTH = 254;
const GOOGLE_DRIVE_ID_MAX_LENGTH = 100;
const GOOGLE_URL_MAX_LENGTH = 500;
const CLIENT_FIREBASE_ENV_KEYS = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_APP_ID",
  "VITE_FIREBASE_STORAGE_BUCKET",
  "VITE_FIREBASE_MESSAGING_SENDER_ID",
  "VITE_FIREBASE_DATABASE_ID",
];

type RateLimitEntry = {
  count: number;
  windowStart: number;
};

type AppSettings = {
  aiEnabled: boolean;
  activeProvider: string;
  aiAutoTagEnabled: boolean;
  aiSummarizeEnabled: boolean;
  aiNextBestActionEnabled: boolean;
  aiRiskNarrativeEnabled: boolean;
  aiDuplicateDetectionEnabled: boolean;
  aiRequireHumanApproval: boolean;
  privacyMode: "public-read" | "private-read";
  suiteName: string;
  portalName: string;
  logoDataUrl: string;
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
};

type VerifiedUser = {
  uid: string;
  email: string | null;
  claims: Record<string, unknown>;
};

type AppRole = "owner" | "admin" | "collaborator" | "viewer";
type UserPermissionKey = "canManageRoles" | "canManageSettings" | "canEditContent" | "canViewInternalStats";
type UserPermissionSet = Record<UserPermissionKey, boolean>;

type OperationProjectSignal = {
  projectId: string;
  code: string;
  title: string;
  status: string;
  ownerName: string;
  daysLate?: number;
  daysDormant?: number;
  stageAgeDays?: number;
  stageTargetDays?: number;
};

type OperationsDigestReport = {
  generatedAt: string;
  totals: {
    projectsEvaluated: number;
    slaAlerts: number;
    dormantProjects: number;
    overdueStages: number;
  };
  alerts: {
    slaAlerts: OperationProjectSignal[];
    dormantProjects: OperationProjectSignal[];
    overdueStages: OperationProjectSignal[];
  };
  summaryLines: string[];
  delivery: {
    slack: "sent" | "skipped" | "failed";
    email: "sent" | "skipped" | "failed";
  };
};

const aiRateLimitStore = new Map<string, RateLimitEntry>();
const upstashRestUrl = process.env.UPSTASH_REDIS_REST_URL || "";
const upstashRestToken = process.env.UPSTASH_REDIS_REST_TOKEN || "";
const hasUpstash = Boolean(upstashRestUrl && upstashRestToken);
const STAGE_TARGET_DAYS: Record<string, number> = {
  "Intake / Proposed": 7,
  Scoping: 14,
  "In Progress": 30,
  "Pilot / Testing": 14,
  "Review / Approval": 10,
};
const DEFAULT_BOOTSTRAP_OWNER_EMAIL = "whuggins@law.stanford.edu";
const DEFAULT_ELEVATED_PASSWORD = "ChangeMe1234";

function getClientIp(req: express.Request): string {
  const header = req.headers["x-forwarded-for"];
  if (typeof header === "string") {
    const value = header.split(",")[0]?.trim();
    if (value) return value;
  }
  if (Array.isArray(header) && header[0]) {
    return header[0];
  }
  return req.ip || "unknown";
}

function auditLog(eventType: string, payload: Record<string, unknown>, level: "info" | "error" = "info"): void {
  const event = {
    timestamp: new Date().toISOString(),
    eventType,
    ...payload,
  };
  const serialized = JSON.stringify(event);
  if (level === "error") {
    console.error(serialized);
    return;
  }
  console.log(serialized);
}

function getBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(" ");
  if (scheme !== "Bearer" || !token) return null;
  return token;
}

function claimIsTrue(claims: Record<string, unknown>, key: string): boolean {
  return claims[key] === true;
}

function normalizeRoleFromClaims(claims: Record<string, unknown>): AppRole {
  const roleClaim = claims.role;
  if (roleClaim === "owner" || roleClaim === "admin" || roleClaim === "collaborator" || roleClaim === "viewer") {
    return roleClaim;
  }
  if (claims.admin === true) return "admin";
  return "viewer";
}

function isOwnerRole(role: AppRole): boolean {
  return role === "owner";
}

function isAdminRole(role: AppRole): boolean {
  return role === "owner" || role === "admin";
}

function canManageSettings(role: AppRole): boolean {
  return isAdminRole(role);
}

function defaultPermissionsForRole(role: AppRole): UserPermissionSet {
  return {
    canManageRoles: isAdminRole(role),
    canManageSettings: canManageSettings(role),
    canEditContent: role === "owner" || role === "admin" || role === "collaborator",
    canViewInternalStats: true,
  };
}

function sanitizePermissionSet(input: unknown, role: AppRole): UserPermissionSet {
  const fallback = defaultPermissionsForRole(role);
  if (!input || typeof input !== "object") return fallback;
  const source = input as Record<string, unknown>;
  return {
    canManageRoles: source.canManageRoles === true,
    canManageSettings: source.canManageSettings === true,
    canEditContent: source.canEditContent === true,
    canViewInternalStats: source.canViewInternalStats === true,
  };
}

function claimIncludesGroup(claims: Record<string, unknown>, allowedGroups: string[]): boolean {
  const groups = claims.groups;
  if (!Array.isArray(groups)) return false;
  return groups.some((group) => typeof group === "string" && allowedGroups.includes(group));
}

function getAdminAuth(): admin.auth.Auth {
  if (!adminAuth) {
    throw new Error("Firebase Admin SDK is not initialized");
  }
  return adminAuth;
}

async function pause(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function isInternalUser(claims: Record<string, unknown>): boolean {
  return (
    claimIsTrue(claims, "admin") ||
    claimIsTrue(claims, "domain_authorized") ||
    claimIsTrue(claims, "org_member") ||
    claimIncludesGroup(claims, ["internal", "staff", "team", "employee"])
  );
}

function requireInternalAdmin(user: VerifiedUser): { ok: true } | { ok: false; status: number; error: string } {
  if ((user.email || "").trim().toLowerCase() === DEFAULT_BOOTSTRAP_OWNER_EMAIL) {
    return { ok: true };
  }
  const role = normalizeRoleFromClaims(user.claims);
  // Owners have super privileges — bypass the internal domain/group check entirely
  if (isOwnerRole(role)) {
    return { ok: true };
  }
  if (!isInternalUser(user.claims)) {
    return { ok: false, status: 403, error: "Internal domain/group authorization required" };
  }
  const permissions = sanitizePermissionSet(user.claims.permissions, role);
  if (!permissions.canManageSettings) {
    return { ok: false, status: 403, error: "Admin or owner role required" };
  }
  return { ok: true };
}

function checkRateLimit(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  const current = aiRateLimitStore.get(key);

  if (!current || now - current.windowStart >= windowMs) {
    aiRateLimitStore.set(key, { count: 1, windowStart: now });
    return true;
  }

  if (current.count >= maxRequests) {
    return false;
  }

  current.count += 1;
  aiRateLimitStore.set(key, current);
  return true;
}

async function checkRateLimitDistributed(
  key: string,
  options: { maxRequests: number; windowMs: number; namespace: string },
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const { maxRequests, windowMs, namespace } = options;
  if (!hasUpstash) {
    return {
      allowed: checkRateLimit(`${namespace}:${key}`, maxRequests, windowMs),
      retryAfterSeconds: Math.ceil(windowMs / 1000),
    };
  }

  const windowSeconds = Math.ceil(windowMs / 1000);
  const windowStart = Math.floor(Date.now() / windowMs);
  const redisKey = `${namespace}:${key}:${windowStart}`;
  const incrResponse = await fetch(`${upstashRestUrl}/incr/${encodeURIComponent(redisKey)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${upstashRestToken}` },
  });
  if (!incrResponse.ok) {
    throw new Error("Upstash rate limit increment failed");
  }
  const incrData = (await incrResponse.json()) as { result?: number };
  const requestCount = Number(incrData.result ?? 0);

  if (requestCount === 1) {
    const expireResponse = await fetch(`${upstashRestUrl}/expire/${encodeURIComponent(redisKey)}/${windowSeconds}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${upstashRestToken}` },
    });
    if (!expireResponse.ok) {
      throw new Error("Upstash rate limit expiration failed");
    }
  }

  return {
    allowed: requestCount <= maxRequests,
    retryAfterSeconds: windowSeconds,
  };
}

function enforceRequestSizeLimit(req: express.Request, maxBytes: number): boolean {
  const contentLengthHeader = req.headers["content-length"];
  const reportedSize = typeof contentLengthHeader === "string" ? Number(contentLengthHeader) : 0;
  if (Number.isFinite(reportedSize) && reportedSize > maxBytes) {
    return false;
  }

  if (!req.body || typeof req.body !== "object") {
    return true;
  }

  const actualBytes = Buffer.byteLength(JSON.stringify(req.body), "utf8");
  return actualBytes <= maxBytes;
}

async function withTimeout<T>(work: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  let timeoutId: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });
  try {
    return await Promise.race([work, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function sanitizeServerError(error: unknown): string {
  console.error("AI Generation Error", {
    message: error instanceof Error ? error.message : "Unknown server error",
  });
  return "Unable to generate AI content right now. Please try again later.";
}

function getAllowedCorsOrigins(): string[] {
  const configuredOrigins = process.env.CORS_ALLOWED_ORIGINS || "";
  return configuredOrigins
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function getTrustProxySetting(): boolean | number {
  const configured = process.env.TRUST_PROXY;
  if (!configured) {
    return process.env.NODE_ENV === "production" ? 1 : false;
  }

  if (configured === "true") return true;
  if (configured === "false") return false;

  const parsed = Number(configured);
  if (Number.isInteger(parsed) && parsed >= 0) {
    return parsed;
  }

  console.warn(`Invalid TRUST_PROXY value "${configured}". Falling back to secure default.`);
  return process.env.NODE_ENV === "production" ? 1 : false;
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === "object") {
    const maybeTimestamp = value as { seconds?: number; nanoseconds?: number; toDate?: () => Date };
    if (typeof maybeTimestamp.toDate === "function") {
      const converted = maybeTimestamp.toDate();
      return Number.isNaN(converted.getTime()) ? null : converted;
    }
    if (typeof maybeTimestamp.seconds === "number") {
      const converted = new Date((maybeTimestamp.seconds * 1000) + ((maybeTimestamp.nanoseconds || 0) / 1e6));
      return Number.isNaN(converted.getTime()) ? null : converted;
    }
  }
  return null;
}

function daysBetween(start: Date, end: Date): number {
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
}

function parseFirestoreValue(field: Record<string, unknown> | undefined): unknown {
  if (!field) return undefined;
  if (typeof field.stringValue === "string") return field.stringValue;
  if (typeof field.integerValue === "string") return Number(field.integerValue);
  if (typeof field.doubleValue === "number") return field.doubleValue;
  if (typeof field.booleanValue === "boolean") return field.booleanValue;
  if (field.timestampValue) return field.timestampValue;
  if (field.mapValue && typeof field.mapValue === "object") {
    const mapFields = (field.mapValue as { fields?: Record<string, Record<string, unknown>> }).fields || {};
    return Object.fromEntries(Object.entries(mapFields).map(([key, nested]) => [key, parseFirestoreValue(nested)]));
  }
  return undefined;
}

function parseFirestoreDocument(document: { name?: string; fields?: Record<string, Record<string, unknown>> }): Record<string, unknown> {
  const docId = document.name?.split("/").pop() || "";
  const fields = document.fields || {};
  const parsed: Record<string, unknown> = { id: docId };
  for (const [key, value] of Object.entries(fields)) {
    parsed[key] = parseFirestoreValue(value);
  }
  return parsed;
}

async function fetchProjectsForOps(idToken: string): Promise<Record<string, unknown>[]> {
  const projectId = process.env.VITE_FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error("VITE_FIREBASE_PROJECT_ID is not configured on the server");

  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/projects?pageSize=500`,
    { headers: { Authorization: `Bearer ${idToken}` } },
  );

  if (!response.ok) {
    throw new Error("Unable to read projects for operations digest");
  }

  const data = (await response.json()) as { documents?: Array<{ name?: string; fields?: Record<string, Record<string, unknown>> }> };
  return (data.documents || []).map(parseFirestoreDocument);
}

function buildOperationsDigest(projects: Record<string, unknown>[]): OperationsDigestReport {
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const active = projects.filter((project) => project.status !== "Launched");

  const slaAlerts: OperationProjectSignal[] = [];
  const dormantProjects: OperationProjectSignal[] = [];
  const overdueStages: OperationProjectSignal[] = [];

  for (const project of active) {
    const dueDate = toDate(project.dueDate);
    const updatedAt = toDate(project.updatedAt) || toDate(project.createdAt);
    const stageStart = updatedAt || toDate(project.createdAt) || now;

    const status = typeof project.status === "string" ? project.status : "Intake / Proposed";
    const progress = typeof project.progress === "number" ? project.progress : 0;
    const owner = (project.owner as { name?: string } | undefined)?.name || "Unassigned";
    const stageTargetDays = STAGE_TARGET_DAYS[status];
    const stageAgeDays = daysBetween(stageStart, now);

    const signalBase: OperationProjectSignal = {
      projectId: String(project.id || ""),
      code: String(project.code || "N/A"),
      title: String(project.title || "Untitled Project"),
      status,
      ownerName: owner,
    };

    if (dueDate && dueDate < startToday && progress < 100) {
      slaAlerts.push({ ...signalBase, daysLate: daysBetween(dueDate, startToday) });
    }

    if (updatedAt) {
      const daysDormant = daysBetween(updatedAt, now);
      if (daysDormant >= 30) {
        dormantProjects.push({ ...signalBase, daysDormant });
      }
    }

    if (typeof stageTargetDays === "number" && stageAgeDays > stageTargetDays) {
      overdueStages.push({ ...signalBase, stageAgeDays, stageTargetDays });
    }
  }

  const summaryLines = [
    `Projects evaluated: ${projects.length}`,
    `SLA alerts: ${slaAlerts.length}`,
    `Dormant projects (30+ days inactive): ${dormantProjects.length}`,
    `Overdue stages: ${overdueStages.length}`,
  ];

  return {
    generatedAt: now.toISOString(),
    totals: {
      projectsEvaluated: projects.length,
      slaAlerts: slaAlerts.length,
      dormantProjects: dormantProjects.length,
      overdueStages: overdueStages.length,
    },
    alerts: {
      slaAlerts: slaAlerts.slice(0, 25),
      dormantProjects: dormantProjects.slice(0, 25),
      overdueStages: overdueStages.slice(0, 25),
    },
    summaryLines,
    delivery: {
      slack: "skipped",
      email: "skipped",
    },
  };
}

function buildDigestText(report: OperationsDigestReport): string {
  const headline = `Weekly operations digest (${report.generatedAt})`;
  const section = (title: string, items: OperationProjectSignal[], projector: (item: OperationProjectSignal) => string) => {
    if (items.length === 0) return `${title}\n- none`;
    return `${title}\n${items.slice(0, 5).map((item) => `- ${projector(item)}`).join("\n")}`;
  };

  return [
    headline,
    ...report.summaryLines,
    "",
    section("SLA alerts", report.alerts.slaAlerts, (item) => `${item.code} ${item.title} (${item.daysLate} days late)`),
    "",
    section("Dormant projects", report.alerts.dormantProjects, (item) => `${item.code} ${item.title} (${item.daysDormant} days dormant)`),
    "",
    section("Overdue stages", report.alerts.overdueStages, (item) => `${item.code} ${item.title} (${item.stageAgeDays}/${item.stageTargetDays} days in stage)`),
  ].join("\n");
}

async function deliverDigest(report: OperationsDigestReport): Promise<OperationsDigestReport["delivery"]> {
  const text = buildDigestText(report);
  const delivery: OperationsDigestReport["delivery"] = {
    slack: "skipped",
    email: "skipped",
  };

  if (process.env.SLACK_WEBHOOK_URL) {
    try {
      const slackResponse = await fetch(process.env.SLACK_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      delivery.slack = slackResponse.ok ? "sent" : "failed";
    } catch {
      delivery.slack = "failed";
    }
  }

  if (process.env.OPS_DIGEST_EMAIL_WEBHOOK_URL) {
    try {
      const emailResponse = await fetch(process.env.OPS_DIGEST_EMAIL_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: "Weekly operations digest",
          body: text,
          report,
        }),
      });
      delivery.email = emailResponse.ok ? "sent" : "failed";
    } catch {
      delivery.email = "failed";
    }
  }

  return delivery;
}

/**
 * Prefer Admin SDK verification so API routes work when only FIREBASE_SERVICE_ACCOUNT_JSON is set
 * (VITE_* keys are often omitted from server runtime on Vercel).
 */
function decodedIdTokenToCustomClaims(decoded: admin.auth.DecodedIdToken): Record<string, unknown> {
  const reserved = new Set([
    "aud",
    "auth_time",
    "user_id",
    "sub",
    "iat",
    "exp",
    "iss",
    "firebase",
    "uid",
    "email",
    "email_verified",
    "name",
    "picture",
    "phone_number",
    "sign_in_provider",
    "sign_in_second_factor",
    "second_factor_identifier",
  ]);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(decoded)) {
    if (!reserved.has(key)) {
      out[key] = value;
    }
  }
  return out;
}

async function verifyFirebaseUserWithAdmin(idToken: string): Promise<VerifiedUser | null> {
  if (!adminAuth) return null;
  try {
    const decoded = await adminAuth.verifyIdToken(idToken, true);
    return {
      uid: decoded.uid,
      email: decoded.email ?? null,
      claims: decodedIdTokenToCustomClaims(decoded),
    };
  } catch {
    return null;
  }
}

async function verifyFirebaseUser(idToken: string): Promise<VerifiedUser | null> {
  const viaAdmin = await verifyFirebaseUserWithAdmin(idToken);
  if (viaAdmin) return viaAdmin;

  try {
    const apiKey = process.env.VITE_FIREBASE_API_KEY;
    if (!apiKey) return null;
    const lookupResponse = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    });
    if (!lookupResponse.ok) return null;
    const lookupData = await lookupResponse.json() as {
      users?: Array<{ localId?: string; email?: string; customAttributes?: string }>;
    };
    const user = lookupData.users?.[0];
    if (!user?.localId) return null;

    let claims: Record<string, unknown> = {};
    if (typeof user.customAttributes === "string" && user.customAttributes.trim().length > 0) {
      claims = JSON.parse(user.customAttributes) as Record<string, unknown>;
    }
    try {
      const adminLookup = await identityToolkitCall("/accounts:lookup", { localId: [user.localId] });
      const adminUser = (adminLookup.users as Array<{ customAttributes?: string }> | undefined)?.[0];
      if (typeof adminUser?.customAttributes === "string" && adminUser.customAttributes.trim().length > 0) {
        claims = JSON.parse(adminUser.customAttributes) as Record<string, unknown>;
      }
    } catch {
      // Fall back to claims returned from the public lookup response.
    }

    return {
      uid: user.localId,
      email: user.email || null,
      claims,
    };
  } catch {
    return null;
  }
}

const GOOGLE_CALENDAR_ID_PATTERN = /^[\w!#$%&'*+/=?^`{|}~.-]+@[\w.-]+$/;
const GOOGLE_RESOURCE_ID_PATTERN = /^[A-Za-z0-9_-]{10,100}$/;
const GOOGLE_TIMEZONE_PATTERN = /^[A-Za-z0-9_+\-/]{1,64}$/;

function validateOptionalGoogleString(
  value: unknown,
  options: { maxLength: number; pattern?: RegExp },
): { ok: true; value: string } | { ok: false } {
  if (value === undefined || value === null || value === "") return { ok: true, value: "" };
  if (typeof value !== "string") return { ok: false };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: true, value: "" };
  if (trimmed.length > options.maxLength) return { ok: false };
  if (options.pattern && !options.pattern.test(trimmed)) return { ok: false };
  return { ok: true, value: trimmed };
}

function validateSettings(input: unknown): AppSettings | null {
  if (!input || typeof input !== "object") return null;
  const source = input as Record<string, unknown>;

  if (
    typeof source.aiEnabled !== "boolean" ||
    (source.aiAutoTagEnabled !== undefined && typeof source.aiAutoTagEnabled !== "boolean") ||
    (source.aiSummarizeEnabled !== undefined && typeof source.aiSummarizeEnabled !== "boolean") ||
    typeof source.aiNextBestActionEnabled !== "boolean" ||
    typeof source.aiRiskNarrativeEnabled !== "boolean" ||
    typeof source.aiDuplicateDetectionEnabled !== "boolean" ||
    typeof source.aiRequireHumanApproval !== "boolean" ||
    typeof source.activeProvider !== "string" ||
    !ALLOWED_PROVIDERS.has(source.activeProvider) ||
    (source.privacyMode !== "public-read" && source.privacyMode !== "private-read") ||
    typeof source.suiteName !== "string" ||
    source.suiteName.trim().length === 0 ||
    source.suiteName.length > 80 ||
    typeof source.portalName !== "string" ||
    source.portalName.trim().length === 0 ||
    source.portalName.length > 80 ||
    typeof source.logoDataUrl !== "string" ||
    source.logoDataUrl.length > 150_000 ||
    typeof source.primaryColor !== "string" ||
    !source.primaryColor.match(/^#[0-9A-Fa-f]{6}$/) ||
    typeof source.brandDarkColor !== "string" ||
    !source.brandDarkColor.match(/^#[0-9A-Fa-f]{6}$/) ||
    (source.customFooter !== undefined && (typeof source.customFooter !== "string" || source.customFooter.length > 500)) ||
    (source.helpContactEmail !== undefined && (typeof source.helpContactEmail !== "string" || source.helpContactEmail.length > 254)) ||
    (source.googleCalendarEnabled !== undefined && typeof source.googleCalendarEnabled !== "boolean") ||
    (source.googleDriveEnabled !== undefined && typeof source.googleDriveEnabled !== "boolean")
  ) {
    return null;
  }

  const calendarId = validateOptionalGoogleString(source.googleCalendarId, {
    maxLength: GOOGLE_CALENDAR_ID_MAX_LENGTH,
    pattern: GOOGLE_CALENDAR_ID_PATTERN,
  });
  const calendarUrl = validateOptionalGoogleString(source.googleCalendarUrl, { maxLength: GOOGLE_URL_MAX_LENGTH });
  const calendarTimezone = validateOptionalGoogleString(source.googleCalendarTimezone, {
    maxLength: 64,
    pattern: GOOGLE_TIMEZONE_PATTERN,
  });
  const driveId = validateOptionalGoogleString(source.googleDriveId, {
    maxLength: GOOGLE_DRIVE_ID_MAX_LENGTH,
    pattern: GOOGLE_RESOURCE_ID_PATTERN,
  });
  const driveUrl = validateOptionalGoogleString(source.googleDriveUrl, { maxLength: GOOGLE_URL_MAX_LENGTH });
  const driveFolderId = validateOptionalGoogleString(source.googleDriveFolderId, {
    maxLength: GOOGLE_DRIVE_ID_MAX_LENGTH,
    pattern: GOOGLE_RESOURCE_ID_PATTERN,
  });

  if (!calendarId.ok || !calendarUrl.ok || !calendarTimezone.ok || !driveId.ok || !driveUrl.ok || !driveFolderId.ok) {
    return null;
  }

  const aiEnabled = source.aiEnabled;
  const aiAutoTagEnabled =
    typeof source.aiAutoTagEnabled === "boolean" ? source.aiAutoTagEnabled : aiEnabled;
  const aiSummarizeEnabled =
    typeof source.aiSummarizeEnabled === "boolean" ? source.aiSummarizeEnabled : aiEnabled;

  return {
    aiEnabled,
    activeProvider: source.activeProvider,
    aiAutoTagEnabled,
    aiSummarizeEnabled,
    aiNextBestActionEnabled: source.aiNextBestActionEnabled,
    aiRiskNarrativeEnabled: source.aiRiskNarrativeEnabled,
    aiDuplicateDetectionEnabled: source.aiDuplicateDetectionEnabled,
    aiRequireHumanApproval: source.aiRequireHumanApproval,
    privacyMode: source.privacyMode,
    suiteName: source.suiteName.trim(),
    portalName: source.portalName.trim(),
    logoDataUrl: source.logoDataUrl,
    primaryColor: source.primaryColor,
    brandDarkColor: source.brandDarkColor,
    customFooter: typeof source.customFooter === "string" ? source.customFooter.trim() : undefined,
    helpContactEmail: typeof source.helpContactEmail === "string" ? source.helpContactEmail.trim() : undefined,
    googleCalendarEnabled: source.googleCalendarEnabled === true,
    googleCalendarId: calendarId.value,
    googleCalendarUrl: calendarUrl.value,
    googleCalendarTimezone: calendarTimezone.value,
    googleDriveEnabled: source.googleDriveEnabled === true,
    googleDriveId: driveId.value,
    googleDriveUrl: driveUrl.value,
    googleDriveFolderId: driveFolderId.value,
  };
}

function toFirestoreFields(settings: AppSettings): Record<string, { stringValue?: string; booleanValue?: boolean }> {
  return {
    aiEnabled: { booleanValue: settings.aiEnabled },
    activeProvider: { stringValue: settings.activeProvider },
    aiAutoTagEnabled: { booleanValue: settings.aiAutoTagEnabled },
    aiSummarizeEnabled: { booleanValue: settings.aiSummarizeEnabled },
    aiNextBestActionEnabled: { booleanValue: settings.aiNextBestActionEnabled },
    aiRiskNarrativeEnabled: { booleanValue: settings.aiRiskNarrativeEnabled },
    aiDuplicateDetectionEnabled: { booleanValue: settings.aiDuplicateDetectionEnabled },
    aiRequireHumanApproval: { booleanValue: settings.aiRequireHumanApproval },
    privacyMode: { stringValue: settings.privacyMode },
    suiteName: { stringValue: settings.suiteName },
    portalName: { stringValue: settings.portalName },
    logoDataUrl: { stringValue: settings.logoDataUrl },
    primaryColor: { stringValue: settings.primaryColor },
    brandDarkColor: { stringValue: settings.brandDarkColor },
    ...(settings.customFooter !== undefined && { customFooter: { stringValue: settings.customFooter } }),
    ...(settings.helpContactEmail !== undefined && { helpContactEmail: { stringValue: settings.helpContactEmail } }),
    googleCalendarEnabled: { booleanValue: settings.googleCalendarEnabled === true },
    googleCalendarId: { stringValue: settings.googleCalendarId || "" },
    googleCalendarUrl: { stringValue: settings.googleCalendarUrl || "" },
    googleCalendarTimezone: { stringValue: settings.googleCalendarTimezone || "" },
    googleDriveEnabled: { booleanValue: settings.googleDriveEnabled === true },
    googleDriveId: { stringValue: settings.googleDriveId || "" },
    googleDriveUrl: { stringValue: settings.googleDriveUrl || "" },
    googleDriveFolderId: { stringValue: settings.googleDriveFolderId || "" },
  };
}

function fromFirestoreFields(
  fields: Record<string, { stringValue?: string; booleanValue?: boolean }> | undefined,
): Partial<AppSettings> {
  if (!fields) return {};
  return {
    aiEnabled: fields.aiEnabled?.booleanValue,
    activeProvider: fields.activeProvider?.stringValue,
    aiAutoTagEnabled: fields.aiAutoTagEnabled?.booleanValue,
    aiSummarizeEnabled: fields.aiSummarizeEnabled?.booleanValue,
    aiNextBestActionEnabled: fields.aiNextBestActionEnabled?.booleanValue,
    aiRiskNarrativeEnabled: fields.aiRiskNarrativeEnabled?.booleanValue,
    aiDuplicateDetectionEnabled: fields.aiDuplicateDetectionEnabled?.booleanValue,
    aiRequireHumanApproval: fields.aiRequireHumanApproval?.booleanValue,
    privacyMode: fields.privacyMode?.stringValue as AppSettings["privacyMode"] | undefined,
    suiteName: fields.suiteName?.stringValue,
    portalName: fields.portalName?.stringValue,
    logoDataUrl: fields.logoDataUrl?.stringValue,
    primaryColor: fields.primaryColor?.stringValue,
    brandDarkColor: fields.brandDarkColor?.stringValue,
    customFooter: fields.customFooter?.stringValue,
    helpContactEmail: fields.helpContactEmail?.stringValue,
    googleCalendarEnabled: fields.googleCalendarEnabled?.booleanValue,
    googleCalendarId: fields.googleCalendarId?.stringValue,
    googleCalendarUrl: fields.googleCalendarUrl?.stringValue,
    googleCalendarTimezone: fields.googleCalendarTimezone?.stringValue,
    googleDriveEnabled: fields.googleDriveEnabled?.booleanValue,
    googleDriveId: fields.googleDriveId?.stringValue,
    googleDriveUrl: fields.googleDriveUrl?.stringValue,
    googleDriveFolderId: fields.googleDriveFolderId?.stringValue,
  };
}

function getFirebaseProjectId(): string {
  const value = process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || process.env.VITE_FIREBASE_PROJECT_ID;
  if (!value) throw new Error("Firebase project id is not configured");
  return value;
}

function getServiceAccount(): { clientEmail: string; privateKey: string } {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is required for role administration");
  const parsed = JSON.parse(sanitizeServiceAccountJson(raw)) as { client_email?: string; private_key?: string };
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is missing client_email/private_key");
  }
  return {
    clientEmail: parsed.client_email,
    privateKey: parsed.private_key.replace(/\\n/g, "\n"),
  };
}

async function getGoogleAccessToken(scope = "https://www.googleapis.com/auth/cloud-platform"): Promise<string> {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
    const { clientEmail, privateKey } = getServiceAccount();
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({
      iss: clientEmail,
      scope,
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })).toString("base64url");
    const unsigned = `${header}.${payload}`;
    const signature = createSign("RSA-SHA256").update(unsigned).sign(privateKey, "base64url");
    const assertion = `${unsigned}.${signature}`;

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    });
    if (!tokenRes.ok) throw new Error("Unable to fetch Google access token");
    const tokenData = await tokenRes.json() as { access_token?: string };
    if (!tokenData.access_token) throw new Error("Google access token missing");
    return tokenData.access_token;
    } catch (saError) {
      console.error("Service account token fetch failed, falling back to ADC:", saError);
      // Fall through to ADC below
    }
  }

  // Fallback: Application Default Credentials via GCP metadata server (Cloud Run, App Engine, GCE)
  try {
    const metaRes = await fetch(
      `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token?scopes=${encodeURIComponent(scope)}`,
      { headers: { "Metadata-Flavor": "Google" } },
    );
    if (metaRes.ok) {
      const metaData = await metaRes.json() as { access_token?: string };
      if (metaData.access_token) return metaData.access_token;
    }
  } catch {
    // Not running on GCP or metadata server unreachable
  }

  throw new Error("No credentials available: set FIREBASE_SERVICE_ACCOUNT_JSON or deploy to a GCP environment with Application Default Credentials");
}

async function identityToolkitCall(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const token = await getGoogleAccessToken("https://www.googleapis.com/auth/identitytoolkit");
  const projectId = getFirebaseProjectId();
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${projectId}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((data as { error?: { message?: string } }).error?.message || "Identity Toolkit call failed");
  return data as Record<string, unknown>;
}

async function firestoreCall(
  path: string,
  options: { method?: string; body?: unknown; updateMaskFieldPaths?: string[] } = {},
): Promise<Record<string, unknown>> {
  const token = await getGoogleAccessToken("https://www.googleapis.com/auth/datastore");
  const projectId = getFirebaseProjectId();
  let url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${path}`;
  if (options.updateMaskFieldPaths && options.updateMaskFieldPaths.length > 0) {
    const params = new URLSearchParams();
    for (const fieldPath of options.updateMaskFieldPaths) {
      params.append("updateMask.fieldPaths", fieldPath);
    }
    url += `?${params.toString()}`;
  }
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((data as { error?: { message?: string } }).error?.message || "Firestore admin call failed");
  return data as Record<string, unknown>;
}

async function fetchFirestoreSettings(): Promise<Partial<AppSettings>> {
  try {
    const result = await firestoreCall("settings/global");
    return fromFirestoreFields(result.fields as Record<string, { stringValue?: string; booleanValue?: boolean }> | undefined);
  } catch {
    return {};
  }
}

async function saveFirestoreSettings(settings: AppSettings): Promise<void> {
  const fields = toFirestoreFields(settings);
  await firestoreCall("settings/global", {
    method: "PATCH",
    body: { fields },
    // Without updateMask, Firestore replaces the whole document and drops fields
    // we do not send in this payload (e.g. elevatedPasswordHash co-located on settings/global).
    updateMaskFieldPaths: Object.keys(fields),
  });
}

function validateRole(input: unknown): AppRole | null {
  return input === "owner" || input === "admin" || input === "collaborator" || input === "viewer" ? input : null;
}

async function countOwnersFromUsersMirror(): Promise<number> {
  const result = await firestoreCall("users?pageSize=500");
  const documents = (result.documents as Array<{ fields?: Record<string, Record<string, unknown>> }> | undefined) || [];
  return documents.filter((doc) => parseFirestoreValue(doc.fields?.role) === "owner").length;
}

function toFirestoreUserFields(input: {
  email: string;
  displayName: string;
  role: AppRole;
  status: "active" | "disabled";
  permissions?: UserPermissionSet;
  actorUid?: string;
}): Record<string, Record<string, unknown>> {
  const now = new Date().toISOString();
  const permissions = input.permissions || defaultPermissionsForRole(input.role);
  return {
    email: { stringValue: input.email },
    displayName: { stringValue: input.displayName || "" },
    role: { stringValue: input.role },
    status: { stringValue: input.status },
    permissions: {
      mapValue: {
        fields: {
          canManageRoles: { booleanValue: permissions.canManageRoles },
          canManageSettings: { booleanValue: permissions.canManageSettings },
          canEditContent: { booleanValue: permissions.canEditContent },
          canViewInternalStats: { booleanValue: permissions.canViewInternalStats },
        },
      },
    },
    updatedAt: { timestampValue: now },
    createdAt: { timestampValue: now },
    lastRoleChangedAt: { timestampValue: now },
    lastRoleChangedBy: { stringValue: input.actorUid || "" },
  };
}

async function writeAuditLog(entry: {
  actorUid: string;
  actorEmail: string;
  targetUid: string;
  targetEmail: string;
  action: string;
  oldRole?: AppRole;
  newRole?: AppRole;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const fields: Record<string, Record<string, unknown>> = {
    actorUid: { stringValue: entry.actorUid },
    actorEmail: { stringValue: entry.actorEmail },
    targetUid: { stringValue: entry.targetUid },
    targetEmail: { stringValue: entry.targetEmail },
    action: { stringValue: entry.action },
    timestamp: { timestampValue: new Date().toISOString() },
  };
  if (entry.oldRole) fields.oldRole = { stringValue: entry.oldRole };
  if (entry.newRole) fields.newRole = { stringValue: entry.newRole };
  if (entry.metadata) {
    fields.metadata = {
      mapValue: {
        fields: Object.fromEntries(
          Object.entries(entry.metadata).map(([key, value]) => [key, { stringValue: JSON.stringify(value) }]),
        ),
      },
    };
  }
  await firestoreCall("adminAudit", { method: "POST", body: { fields } });
}

function configuredOwnerEmails(): string[] {
  const configured = (process.env.OWNER_EMAILS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (configured.length > 0) return configured;
  return [DEFAULT_BOOTSTRAP_OWNER_EMAIL];
}

function isEmailEligibleForOwnerBootstrap(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  return configuredOwnerEmails().includes(normalized);
}

function canClaimInitialOwnerAccess(user: VerifiedUser, ownerCount: number): boolean {
  if (ownerCount > 0) return false;
  if (isEmailEligibleForOwnerBootstrap(user.email)) return true;
  const ownerEmails = configuredOwnerEmails();
  if (ownerEmails.length > 0) return false;
  return true;
}

async function getUserMirrorRoleAndPermissions(uid: string): Promise<{ role: AppRole | null; permissions: UserPermissionSet | null }> {
  try {
    const result = await firestoreCall(`users/${uid}`);
    const parsed = parseFirestoreDocument(result as { name?: string; fields?: Record<string, Record<string, unknown>> });
    const mirroredRole = validateRole(parsed.role);
    if (!mirroredRole) return { role: null, permissions: null };
    return {
      role: mirroredRole,
      permissions: sanitizePermissionSet(parsed.permissions, mirroredRole),
    };
  } catch {
    return { role: null, permissions: null };
  }
}

function hashPassword(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeCompareHash(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

async function getElevatedAccessConfig(): Promise<{ passwordHash: string; needsChange: boolean }> {
  try {
    const result = await firestoreCall("settings/global");
    const parsed = parseFirestoreDocument(result as { name?: string; fields?: Record<string, Record<string, unknown>> });
    const passwordHash = typeof parsed.elevatedPasswordHash === "string" && parsed.elevatedPasswordHash.length > 0
      ? parsed.elevatedPasswordHash
      : hashPassword(DEFAULT_ELEVATED_PASSWORD);
    const needsChange = typeof parsed.elevatedPasswordNeedsChange === "boolean"
      ? parsed.elevatedPasswordNeedsChange
      : true;
    return { passwordHash, needsChange };
  } catch {
    return { passwordHash: hashPassword(DEFAULT_ELEVATED_PASSWORD), needsChange: true };
  }
}

async function saveElevatedAccessConfig(config: { passwordHash: string; needsChange: boolean }): Promise<void> {
  await firestoreCall("settings/global", {
    method: "PATCH",
    body: {
      fields: {
        elevatedPasswordHash: { stringValue: config.passwordHash },
        elevatedPasswordNeedsChange: { booleanValue: config.needsChange },
      },
    },
    // Restrict write to just these two fields so concurrent settings saves are not clobbered.
    updateMaskFieldPaths: ["elevatedPasswordHash", "elevatedPasswordNeedsChange"],
  });
}

async function resolveEffectiveRole(verifiedUser: VerifiedUser): Promise<AppRole> {
  if ((verifiedUser.email || "").trim().toLowerCase() === DEFAULT_BOOTSTRAP_OWNER_EMAIL) {
    return "owner";
  }
  const mirror = await getUserMirrorRoleAndPermissions(verifiedUser.uid);
  if (mirror.role) return mirror.role;
  return normalizeRoleFromClaims(verifiedUser.claims);
}

async function applyOwnerRoleToUid(input: { uid: string; email: string; displayName: string; actorUid?: string; actorEmail?: string; action: string }): Promise<void> {
  const auth = getAdminAuth();
  const authUser = await auth.getUser(input.uid);
  const oldClaimsRaw = authUser.customClaims || {};
  const oldRole = normalizeRoleFromClaims(oldClaimsRaw);
  const nextPermissions = defaultPermissionsForRole("owner");
  const nextClaims: Record<string, unknown> = { ...oldClaimsRaw, role: "owner", admin: true, permissions: nextPermissions };

  await auth.setCustomUserClaims(input.uid, nextClaims);
  await auth.revokeRefreshTokens(input.uid);

  // Mirror write and audit are best-effort: a Firestore failure must not
  // roll back the Auth claim update that already succeeded above.
  try {
    await firestoreCall(`users/${input.uid}`, {
      method: "PATCH",
      body: {
        fields: toFirestoreUserFields({
          email: input.email,
          displayName: input.displayName || authUser.displayName || "",
          role: "owner",
          permissions: nextPermissions,
          status: "active",
          actorUid: input.actorUid,
        }),
      },
    });
  } catch (mirrorError) {
    console.error(`[applyOwnerRoleToUid] Firestore mirror write failed for uid=${input.uid}:`, mirrorError);
  }

  if (input.actorUid && input.actorEmail) {
    try {
      await writeAuditLog({
        actorUid: input.actorUid,
        actorEmail: input.actorEmail,
        targetUid: input.uid,
        targetEmail: input.email,
        action: input.action,
        oldRole,
        newRole: "owner",
      });
    } catch (auditError) {
      console.error(`[applyOwnerRoleToUid] Audit log write failed:`, auditError);
    }
  }
}

async function bootstrapOwnersFromEnv(): Promise<void> {
  const ownerEmails = configuredOwnerEmails();
  if (ownerEmails.length === 0) return;
  if (!adminAuth) {
    auditLog("owner_bootstrap_skipped", { reason: "firebase_admin_uninitialized" }, "error");
    return;
  }
  const auth = adminAuth;

  for (const email of ownerEmails) {
    try {
      const authUser = await auth.getUserByEmail(email);
      // Skip if claims are already set — avoids unnecessary revokeRefreshTokens on each cold start
      const existingClaims = authUser.customClaims || {};
      if (normalizeRoleFromClaims(existingClaims) === "owner") {
        auditLog("owner_bootstrap_skipped", { email, uid: authUser.uid, reason: "already_owner" });
        continue;
      }
      await applyOwnerRoleToUid({
        uid: authUser.uid,
        email,
        displayName: authUser.displayName || "",
        action: "bootstrap-owner-env",
      });
      auditLog("owner_bootstrap_applied", { email, uid: authUser.uid });
    } catch (error) {
      auditLog("owner_bootstrap_failed", { email, message: error instanceof Error ? error.message : "unknown" }, "error");
    }
  }
}

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      const isAllowedByConfig = allowedOrigins.includes(origin);
      const isAllowedDevOrigin = !isProduction && devOrigins.includes(origin);

      if (isAllowedByConfig || isAllowedDevOrigin) {
        callback(null, true);
        return;
      }

      callback(new Error("CORS origin denied"));
    },
  }),
);
app.use((req, res, next) => {
  // Drive upload routes have their own json parser with a 25MB limit; skip the global cap here.
  if (req.path === "/api/admin/drive/files" && (req.method === "POST" || req.method === "PUT")) return next();
  if (req.path.startsWith("/api/admin/drive/files/") && req.method === "PUT") return next();
  // 512kb headroom so an admin who has uploaded a large logoDataUrl (base64, capped at ~150kb in
  // validateSettings) can still save settings without tripping entity.too.large.
  return express.json({ limit: "512kb" })(req, res, next);
});
app.set("trust proxy", getTrustProxySetting());

if (!hasUpstash) {
  if (isProduction) {
    console.warn(
      "UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required in production for distributed AI rate limiting.",
    );
  } else {
    console.warn("Upstash Redis credentials missing; using in-memory AI rate limiting for non-production only.");
  }
}
let bootstrapFired = false;
app.use("/api", (_req, _res, next) => {
  // Fire bootstrap once in background — never block the request or the cold start
  if (!bootstrapFired) {
    bootstrapFired = true;
    void bootstrapOwnersFromEnv().catch((error) => {
      console.error("Background bootstrap failed:", error);
    });
  }
  next();
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/debug/env", (req, res) => {
  const saRaw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "";
  let saJsonValid = false;
  let saJsonError: string | null = null;
  if (saRaw) {
    try {
      const parsed = JSON.parse(sanitizeServiceAccountJson(saRaw)) as Record<string, unknown>;
      saJsonValid = Boolean(parsed.project_id && parsed.client_email && parsed.private_key);
      if (!saJsonValid) saJsonError = "Parsed OK but missing project_id/client_email/private_key";
    } catch (e) {
      saJsonError = e instanceof Error ? e.message : "JSON.parse failed";
    }
  }
  res.json({
    adminSdkInitialized: adminAuth !== null,
    adminSdkInitError,
    hasServiceAccountJson: Boolean(saRaw),
    serviceAccountJsonValid: saJsonValid,
    serviceAccountJsonError: saJsonError,
    hasFirebaseProjectId: Boolean(process.env.FIREBASE_PROJECT_ID),
    hasViteFirebaseProjectId: Boolean(process.env.VITE_FIREBASE_PROJECT_ID),
    hasGoogleCloudProject: Boolean(process.env.GOOGLE_CLOUD_PROJECT),
    hasViteFirebaseApiKey: Boolean(process.env.VITE_FIREBASE_API_KEY),
    hasOwnerEmails: Boolean(process.env.OWNER_EMAILS),
    resolvedProjectId: process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || process.env.VITE_FIREBASE_PROJECT_ID || null,
    nodeEnv: process.env.NODE_ENV || null,
    isVercel: Boolean(process.env.VERCEL),
  });
});

app.post("/api/auth/reconcile-role", async (req, res) => {
  try {
    const token = getBearerToken(req.headers.authorization);
    if (!token) return res.status(401).json({ error: "Authentication required" });
    const verifiedUser = await verifyFirebaseUser(token);
    if (!verifiedUser) return res.status(401).json({ error: "Invalid or expired auth token" });
    console.log(`[auth/reconcile-role] started uid=${verifiedUser.uid} email=${verifiedUser.email || "unknown"}`);

    const currentRole = normalizeRoleFromClaims(verifiedUser.claims);
    const mirrored = await getUserMirrorRoleAndPermissions(verifiedUser.uid);

    if (currentRole !== "owner" && isEmailEligibleForOwnerBootstrap(verifiedUser.email)) {
      if (!adminAuth) {
        console.warn(`[auth/reconcile-role] Admin SDK unavailable; cannot set claims for uid=${verifiedUser.uid}. Fix FIREBASE_SERVICE_ACCOUNT_JSON in Vercel.`);
        await pause(120);
        return res.json({ role: "owner", reconciled: false, warning: "Admin SDK unavailable; token claims not updated. Check FIREBASE_SERVICE_ACCOUNT_JSON in Vercel environment variables." });
      }
      await applyOwnerRoleToUid({
        uid: verifiedUser.uid,
        email: verifiedUser.email || "",
        displayName: "",
        actorUid: verifiedUser.uid,
        actorEmail: verifiedUser.email || "",
        action: "reconcile-role-refresh",
      });
      await pause(120);
      console.log(`[auth/reconcile-role] promoted to owner uid=${verifiedUser.uid}`);
      return res.json({ role: "owner", reconciled: true });
    }

    if (mirrored.role && mirrored.role !== currentRole) {
      if (!adminAuth) {
        console.warn(
          `[auth/reconcile-role] Admin SDK unavailable; cannot sync token to mirror role=${mirrored.role} uid=${verifiedUser.uid}. Set FIREBASE_SERVICE_ACCOUNT_JSON.`,
        );
        await pause(120);
        return res.json({
          role: mirrored.role,
          reconciled: false,
          warning:
            "Admin SDK unavailable; token claims were not updated to match Firestore. Add FIREBASE_SERVICE_ACCOUNT_JSON to the server environment, then use Refresh permissions.",
        });
      }
      const auth = getAdminAuth();
      const authUser = await auth.getUser(verifiedUser.uid);
      const existingClaims = authUser.customClaims || {};
      const nextPermissions = mirrored.permissions ?? defaultPermissionsForRole(mirrored.role);
      const nextClaims: Record<string, unknown> = {
        ...existingClaims,
        role: mirrored.role,
        permissions: nextPermissions,
        admin: mirrored.role === "owner" || mirrored.role === "admin",
      };
      await auth.setCustomUserClaims(verifiedUser.uid, nextClaims);
      await auth.revokeRefreshTokens(verifiedUser.uid);
      await pause(120);
      console.log(`[auth/reconcile-role] synced uid=${verifiedUser.uid} role=${mirrored.role}`);
      return res.json({ role: mirrored.role, reconciled: true });
    }

    await pause(120);
    console.log(`[auth/reconcile-role] no-op uid=${verifiedUser.uid} role=${currentRole}`);
    return res.json({ role: currentRole, reconciled: false });
  } catch (error) {
    console.error("[auth/reconcile-role] failed", error);
    await pause(120);
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to reconcile role" });
  }
});

app.get("/api/auth/elevated/status", async (req, res) => {
  try {
    const token = getBearerToken(req.headers.authorization);
    if (!token) return res.status(401).json({ error: "Authentication required" });
    const verifiedUser = await verifyFirebaseUser(token);
    if (!verifiedUser) return res.status(401).json({ error: "Invalid or expired auth token" });
    const role = await resolveEffectiveRole(verifiedUser);
    if (role !== "owner" && role !== "admin") {
      return res.json({ required: false, needsChange: false });
    }
    const config = await getElevatedAccessConfig();
    return res.json({ required: true, needsChange: config.needsChange });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to read elevated auth status" });
  }
});

app.post("/api/auth/elevated/login", async (req, res) => {
  try {
    const token = getBearerToken(req.headers.authorization);
    if (!token) return res.status(401).json({ error: "Authentication required" });
    const verifiedUser = await verifyFirebaseUser(token);
    if (!verifiedUser) return res.status(401).json({ error: "Invalid or expired auth token" });
    const role = await resolveEffectiveRole(verifiedUser);
    if (role !== "owner" && role !== "admin") {
      return res.status(403).json({ error: "Elevated access is only for admins and owners" });
    }
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!password) return res.status(400).json({ error: "Password is required" });
    const config = await getElevatedAccessConfig();
    const suppliedHash = hashPassword(password);
    if (!safeCompareHash(suppliedHash, config.passwordHash)) {
      return res.status(401).json({ error: "Invalid password" });
    }
    return res.json({ success: true, needsChange: config.needsChange });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to authenticate elevated access" });
  }
});

app.post("/api/auth/elevated/change-password", async (req, res) => {
  try {
    const token = getBearerToken(req.headers.authorization);
    if (!token) return res.status(401).json({ error: "Authentication required" });
    const verifiedUser = await verifyFirebaseUser(token);
    if (!verifiedUser) return res.status(401).json({ error: "Invalid or expired auth token" });
    const role = await resolveEffectiveRole(verifiedUser);
    if (role !== "owner" && role !== "admin") {
      return res.status(403).json({ error: "Elevated access is only for admins and owners" });
    }
    const currentPassword = typeof req.body?.currentPassword === "string" ? req.body.currentPassword : "";
    const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";
    if (!currentPassword || !newPassword) return res.status(400).json({ error: "Current and new password are required" });
    if (newPassword.length < 8) return res.status(400).json({ error: "New password must be at least 8 characters" });
    const config = await getElevatedAccessConfig();
    const currentHash = hashPassword(currentPassword);
    if (!safeCompareHash(currentHash, config.passwordHash)) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }
    await saveElevatedAccessConfig({
      passwordHash: hashPassword(newPassword),
      needsChange: false,
    });
    return res.json({ success: true, message: "Password updated successfully" });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to change elevated password" });
  }
});

app.post("/api/ai/generate", async (req, res) => {
  const requestId = randomUUID();
  const clientIp = getClientIp(req);

  try {
    const token = getBearerToken(req.headers.authorization);
    if (!token) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const verifiedUser = await verifyFirebaseUser(token);
    if (!verifiedUser) {
      return res.status(401).json({ error: "Invalid or expired auth token" });
    }

    const adminGate = requireInternalAdmin(verifiedUser);
    if (adminGate.ok === false) {
      return res.status(adminGate.status).json({ error: adminGate.error });
    }

    const rateLimitKey = `${verifiedUser.uid}:${clientIp}`;
    const rateLimitResult = await checkRateLimitDistributed(rateLimitKey, {
      maxRequests: AI_RATE_LIMIT_MAX_REQUESTS,
      windowMs: AI_RATE_LIMIT_WINDOW_MS,
      namespace: "ai-rate-limit",
    });
    if (!rateLimitResult.allowed) {
      auditLog("admin_ai_usage_blocked", {
        requestId,
        actorUid: verifiedUser.uid,
        actorEmail: verifiedUser.email,
        provider: req.body?.provider ?? "unknown",
        ip: clientIp,
        reason: "rate_limit_exceeded",
      });
      return res.status(429).json({ error: "Rate limit exceeded. Please wait and try again." });
    }

    const { prompt, provider, model, systemInstruction, feature } = req.body;

    if (typeof feature !== "string" || !AI_FEATURE_KEYS.has(feature)) {
      return res.status(400).json({ error: "Invalid or missing AI feature key" });
    }

    const storedSettings = await fetchFirestoreSettings();
    const masterAiOn = storedSettings.aiEnabled === true;
    const autoTagAllowed =
      typeof storedSettings.aiAutoTagEnabled === "boolean"
        ? storedSettings.aiAutoTagEnabled
        : masterAiOn;
    const summarizeAllowed =
      typeof storedSettings.aiSummarizeEnabled === "boolean"
        ? storedSettings.aiSummarizeEnabled
        : masterAiOn;
    const nextBestAllowed = storedSettings.aiNextBestActionEnabled === true;
    const riskAllowed = storedSettings.aiRiskNarrativeEnabled === true;
    if (!masterAiOn) {
      return res.status(403).json({ error: "AI features are disabled in settings." });
    }
    if (feature === "autoTag" && !autoTagAllowed) {
      return res.status(403).json({ error: "Auto-tag is disabled in settings." });
    }
    if (feature === "summarize" && !summarizeAllowed) {
      return res.status(403).json({ error: "AI summarize is disabled in settings." });
    }
    if (feature === "nextBestAction" && !nextBestAllowed) {
      return res.status(403).json({ error: "Next-best action AI is disabled in settings." });
    }
    if (feature === "riskNarrative" && !riskAllowed) {
      return res.status(403).json({ error: "Risk narrative AI is disabled in settings." });
    }

    if (typeof prompt !== "string" || prompt.trim().length === 0) {
      return res.status(400).json({ error: "Prompt is required" });
    }

    if (prompt.length > MAX_PROMPT_LENGTH) {
      return res.status(400).json({ error: `Prompt exceeds max length of ${MAX_PROMPT_LENGTH}` });
    }

    if (systemInstruction && typeof systemInstruction !== "string") {
      return res.status(400).json({ error: "System instruction must be a string" });
    }

    if (typeof systemInstruction === "string" && systemInstruction.length > MAX_SYSTEM_INSTRUCTION_LENGTH) {
      return res.status(400).json({ error: `System instruction exceeds max length of ${MAX_SYSTEM_INSTRUCTION_LENGTH}` });
    }

    if (typeof provider !== "string" || !ALLOWED_PROVIDERS.has(provider)) {
      return res.status(400).json({ error: "Invalid provider" });
    }
    if (typeof model !== "string" || model.trim().length === 0) {
      return res.status(400).json({ error: "Model is required" });
    }

    auditLog("admin_ai_usage_started", {
      requestId,
      actorUid: verifiedUser.uid,
      actorEmail: verifiedUser.email,
      provider,
      model,
      feature,
      promptLength: prompt.length,
      hasSystemInstruction: typeof systemInstruction === "string" && systemInstruction.length > 0,
      ip: clientIp,
    });

    let responseText = "";

    if (provider === "gemini") {
      if (!process.env.GEMINI_API_KEY) throw new Error("Gemini provider is not configured");
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { systemInstruction }
      });
      responseText = response.text || "";
    } else if (provider === "openai") {
      if (!process.env.OPENAI_API_KEY) throw new Error("OpenAI provider is not configured");
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const messages: Array<{ role: "system" | "user"; content: string }> = [];
      if (systemInstruction) messages.push({ role: "system", content: systemInstruction });
      messages.push({ role: "user", content: prompt });

      const response = await openai.chat.completions.create({
        model,
        messages
      });
      responseText = response.choices[0]?.message?.content || "";
    } else if (provider === "anthropic") {
      if (!process.env.ANTHROPIC_API_KEY) throw new Error("Anthropic provider is not configured");
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const response = await anthropic.messages.create({
        model,
        max_tokens: 1024,
        system: systemInstruction,
        messages: [{ role: "user", content: prompt }]
      });
      responseText = response.content[0].type === "text" ? response.content[0].text : "";
    } else if (provider === "gemma") {
      if (!process.env.GEMMA_API_KEY || !process.env.GEMMA_BASE_URL) {
        throw new Error("Gemma provider is not configured");
      }
      const openai = new OpenAI({
        apiKey: process.env.GEMMA_API_KEY,
        baseURL: process.env.GEMMA_BASE_URL
      });
      const messages: Array<{ role: "system" | "user"; content: string }> = [];
      if (systemInstruction) messages.push({ role: "system", content: systemInstruction });
      messages.push({ role: "user", content: prompt });

      const response = await openai.chat.completions.create({
        model,
        messages
      });
      responseText = response.choices[0]?.message?.content || "";
    } else if (provider === "groc") {
      if (!process.env.GROC_API_KEY || !process.env.GROC_BASE_URL) {
        throw new Error("Groc provider is not configured");
      }
      const openai = new OpenAI({
        apiKey: process.env.GROC_API_KEY,
        baseURL: process.env.GROC_BASE_URL
      });
      const messages: Array<{ role: "system" | "user"; content: string }> = [];
      if (systemInstruction) messages.push({ role: "system", content: systemInstruction });
      messages.push({ role: "user", content: prompt });

      const response = await openai.chat.completions.create({
        model,
        messages
      });
      responseText = response.choices[0]?.message?.content || "";
    } else if (provider === "groq") {
      const groqKey = process.env.GROQ_API_KEY;
      if (!groqKey) {
        throw new Error("Groq provider is not configured");
      }
      const baseURL = (process.env.GROQ_BASE_URL || DEFAULT_GROQ_BASE_URL).replace(/\/$/, "");
      const openai = new OpenAI({
        apiKey: groqKey,
        baseURL,
      });
      const messages: Array<{ role: "system" | "user"; content: string }> = [];
      if (systemInstruction) messages.push({ role: "system", content: systemInstruction });
      messages.push({ role: "user", content: prompt });

      const response = await openai.chat.completions.create({
        model,
        messages,
      });
      responseText = response.choices[0]?.message?.content || "";
    }

    auditLog("admin_ai_usage_succeeded", {
      requestId,
      actorUid: verifiedUser.uid,
      actorEmail: verifiedUser.email,
      provider,
      model,
      responseLength: responseText.length,
      ip: clientIp,
    });
    res.json({ text: responseText });
  } catch (error: unknown) {
    auditLog("admin_ai_usage_failed", {
      requestId,
      message: error instanceof Error ? error.message : "Unknown server error",
      ip: clientIp,
    }, "error");
    const message = sanitizeServerError(error);
    res.status(500).json({ error: message });
  }
});

app.post("/api/admin/settings", async (req, res) => {
  const requestId = randomUUID();
  const clientIp = getClientIp(req);

  try {
    const token = getBearerToken(req.headers.authorization);
    if (!token) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const verifiedUser = await verifyFirebaseUser(token);
    if (!verifiedUser) {
      return res.status(401).json({ error: "Invalid or expired auth token" });
    }
    const adminGate = requireInternalAdmin(verifiedUser);
    if (adminGate.ok === false) {
      return res.status(adminGate.status).json({ error: adminGate.error });
    }

    if (!enforceRequestSizeLimit(req, ADMIN_SETTINGS_MAX_BODY_BYTES)) {
      return res.status(413).json({ error: "Settings payload too large" });
    }

    const settingsRateLimitKey = `${verifiedUser.uid}:${clientIp}`;
    const settingsRateLimitResult = await checkRateLimitDistributed(settingsRateLimitKey, {
      maxRequests: ADMIN_SETTINGS_RATE_LIMIT_MAX_REQUESTS,
      windowMs: ADMIN_SETTINGS_RATE_LIMIT_WINDOW_MS,
      namespace: "admin-settings-rate-limit",
    });
    if (!settingsRateLimitResult.allowed) {
      return res.status(429).json({ error: "Rate limit exceeded. Please wait and try again." });
    }

    const nextSettings = validateSettings(req.body);
    if (!nextSettings) {
      return res.status(400).json({ error: "Invalid settings payload" });
    }

    const previousSettings = await withTimeout(
      fetchFirestoreSettings(),
      ADMIN_SETTINGS_TIMEOUT_MS,
      "Settings request timed out",
    );
    await withTimeout(
      saveFirestoreSettings(nextSettings),
      ADMIN_SETTINGS_TIMEOUT_MS,
      "Settings request timed out",
    );

    auditLog("admin_settings_updated", {
      requestId,
      actorUid: verifiedUser.uid,
      actorEmail: verifiedUser.email,
      ip: clientIp,
      previousSettings,
      nextSettings,
    });

    res.json({ success: true });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "Settings request timed out") {
      return res.status(408).json({ error: "Settings request timed out. Please retry." });
    }
    const detail = error instanceof Error ? error.message : "Unknown server error";
    auditLog("admin_settings_update_failed", {
      requestId,
      message: detail,
      ip: clientIp,
    }, "error");
    // Surface actionable messages for the two failure modes admins can fix themselves.
    const clientMessage =
      detail.includes("PERMISSION_DENIED") || /permission/i.test(detail)
        ? "Firestore rejected this save (permission). Redeploy firestore.rules if you added new settings fields (e.g. aiAutoTagEnabled / aiSummarizeEnabled)."
        : detail.includes("NOT_FOUND") || /not found/i.test(detail)
          ? "Settings document missing or wrong Firebase project. Check FIREBASE_PROJECT_ID matches your Firestore database."
          : "Unable to save settings right now. Please try again later.";
    res.status(500).json({ error: clientMessage, detail: isProduction ? undefined : detail });
  }
});

app.post("/api/admin/operations/run", async (req, res) => {
  const requestId = randomUUID();
  const clientIp = getClientIp(req);

  try {
    const token = getBearerToken(req.headers.authorization);
    if (!token) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const verifiedUser = await verifyFirebaseUser(token);
    if (!verifiedUser) {
      return res.status(401).json({ error: "Invalid or expired auth token" });
    }

    const adminGate = requireInternalAdmin(verifiedUser);
    if (adminGate.ok === false) {
      return res.status(adminGate.status).json({ error: adminGate.error });
    }

    if (!enforceRequestSizeLimit(req, ADMIN_OPERATIONS_MAX_BODY_BYTES)) {
      return res.status(413).json({ error: "Operations payload too large" });
    }

    const operationsRateLimitKey = `${verifiedUser.uid}:${clientIp}`;
    const operationsRateLimitResult = await checkRateLimitDistributed(operationsRateLimitKey, {
      maxRequests: ADMIN_OPERATIONS_RATE_LIMIT_MAX_REQUESTS,
      windowMs: ADMIN_OPERATIONS_RATE_LIMIT_WINDOW_MS,
      namespace: "admin-operations-rate-limit",
    });
    if (!operationsRateLimitResult.allowed) {
      return res.status(429).json({ error: "Rate limit exceeded. Please wait and try again." });
    }

    const projects = await withTimeout(
      fetchProjectsForOps(token),
      ADMIN_OPERATIONS_TIMEOUT_MS,
      "Operations request timed out",
    );
    const report = buildOperationsDigest(projects);
    const delivery = await withTimeout(
      deliverDigest(report),
      ADMIN_OPERATIONS_TIMEOUT_MS,
      "Operations request timed out",
    );
    report.delivery = delivery;

    auditLog("admin_operations_digest_run", {
      requestId,
      actorUid: verifiedUser.uid,
      actorEmail: verifiedUser.email,
      ip: clientIp,
      channel: req.body?.channel ?? "manual",
      totals: report.totals,
      delivery,
    });

    res.json(report);
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "Operations request timed out") {
      return res.status(408).json({ error: "Operations request timed out. Please retry." });
    }
    auditLog("admin_operations_digest_failed", {
      requestId,
      message: error instanceof Error ? error.message : "Unknown server error",
      ip: clientIp,
    }, "error");
    res.status(500).json({ error: "Unable to run operations digest right now. Please try again later." });
  }
});

app.get("/api/admin/users/list", async (req, res) => {
  try {
    const token = getBearerToken(req.headers.authorization);
    if (!token) return res.status(401).json({ error: "Authentication required" });
    const verifiedUser = await verifyFirebaseUser(token);
    if (!verifiedUser) return res.status(401).json({ error: "Invalid or expired auth token" });

    const callerRole = normalizeRoleFromClaims(verifiedUser.claims);
    const callerPermissions = sanitizePermissionSet(verifiedUser.claims.permissions, callerRole);
    if (!callerPermissions.canManageRoles) return res.status(403).json({ error: "Manage roles permission required" });

    const result = await firestoreCall("users?pageSize=500");
    const documents = (result.documents as Array<{ name?: string; fields?: Record<string, Record<string, unknown>> }> | undefined) || [];
    const users = documents.map((doc) => {
      const parsed = parseFirestoreDocument(doc as { name?: string; fields?: Record<string, Record<string, unknown>> });
      return {
        uid: parsed.id,
        email: String(parsed.email || ""),
        displayName: String(parsed.displayName || ""),
        role: validateRole(parsed.role) || "viewer",
        permissions: sanitizePermissionSet(parsed.permissions, validateRole(parsed.role) || "viewer"),
        status: parsed.status === "disabled" ? "disabled" : "active",
        createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : undefined,
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : undefined,
        lastRoleChangedAt: typeof parsed.lastRoleChangedAt === "string" ? parsed.lastRoleChangedAt : undefined,
        lastRoleChangedBy: typeof parsed.lastRoleChangedBy === "string" ? parsed.lastRoleChangedBy : undefined,
      };
    });
    return res.json({ users });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to list users" });
  }
});

app.get("/api/admin/bootstrap/status", async (req, res) => {
  try {
    const token = getBearerToken(req.headers.authorization);
    if (!token) return res.status(401).json({ error: "Authentication required" });
    const verifiedUser = await verifyFirebaseUser(token);
    if (!verifiedUser) return res.status(401).json({ error: "Invalid or expired auth token" });

    let ownerCount = 0;
    try {
      ownerCount = await countOwnersFromUsersMirror();
    } catch {
      // Firestore unavailable; treat as zero owners so bootstrap UI still renders
    }
    const ownerEmails = configuredOwnerEmails();
    const eligible = canClaimInitialOwnerAccess(verifiedUser, ownerCount);
    return res.json({
      ownerCount,
      configured: ownerEmails.length > 0,
      eligible,
      adminSdkAvailable: adminAuth !== null,
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to get bootstrap status" });
  }
});

const handleBootstrapOwnerClaim = async (req: express.Request, res: express.Response) => {
  try {
    const token = getBearerToken(req.headers.authorization);
    if (!token) return res.status(401).json({ error: "Authentication required" });
    const verifiedUser = await verifyFirebaseUser(token);
    if (!verifiedUser) return res.status(401).json({ error: "Invalid or expired auth token" });

    const ownerCount = await countOwnersFromUsersMirror();
    if (ownerCount > 0) {
      return res.status(409).json({ error: "Owner already exists. Use Access Management for role changes." });
    }
    if (!canClaimInitialOwnerAccess(verifiedUser, ownerCount)) {
      return res.status(403).json({
        error: "You are not eligible to claim owner access. Add your email to OWNER_EMAILS or sign in with an internal account.",
      });
    }

    await applyOwnerRoleToUid({
      uid: verifiedUser.uid,
      email: verifiedUser.email || "",
      displayName: "",
      actorUid: verifiedUser.uid,
      actorEmail: verifiedUser.email || "",
      action: "bootstrap-owner-self-service",
    });

    return res.json({ success: true, message: "Owner access granted. Refresh your token to continue." });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to claim owner access" });
  }
};

app.post("/api/admin/bootstrap/claim", handleBootstrapOwnerClaim);
app.post("/api/auth/bootstrap-owner", handleBootstrapOwnerClaim);

app.get("/api/admin/users/audit", async (req, res) => {
  try {
    const token = getBearerToken(req.headers.authorization);
    if (!token) return res.status(401).json({ error: "Authentication required" });
    const verifiedUser = await verifyFirebaseUser(token);
    if (!verifiedUser) return res.status(401).json({ error: "Invalid or expired auth token" });
    const callerRole = normalizeRoleFromClaims(verifiedUser.claims);
    const callerPermissions = sanitizePermissionSet(verifiedUser.claims.permissions, callerRole);
    if (!callerPermissions.canManageRoles) return res.status(403).json({ error: "Manage roles permission required" });
    const result = await firestoreCall("adminAudit?pageSize=100");
    const documents = (result.documents as Array<{ name?: string; fields?: Record<string, Record<string, unknown>> }> | undefined) || [];
    const audit = documents.map((doc) => parseFirestoreDocument(doc as { name?: string; fields?: Record<string, Record<string, unknown>> }));
    return res.json({ audit });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to list audit logs" });
  }
});

app.post("/api/admin/users/set-role", async (req, res) => {
  try {
    const token = getBearerToken(req.headers.authorization);
    if (!token) return res.status(401).json({ error: "Authentication required" });
    const verifiedUser = await verifyFirebaseUser(token);
    if (!verifiedUser) return res.status(401).json({ error: "Invalid or expired auth token" });
    const callerRole = normalizeRoleFromClaims(verifiedUser.claims);
    const callerPermissions = sanitizePermissionSet(verifiedUser.claims.permissions, callerRole);
    if (!callerPermissions.canManageRoles) return res.status(403).json({ error: "Manage roles permission required" });

    const targetUid = typeof req.body?.uid === "string" ? req.body.uid : "";
    const nextRole = validateRole(req.body?.role);
    if (!targetUid || !nextRole) return res.status(400).json({ error: "uid and valid role are required" });
    if (callerRole !== "owner" && nextRole === "owner") {
      return res.status(403).json({ error: "Only owners can grant owner role" });
    }
    console.log(`[admin/set-role] requested actorUid=${verifiedUser.uid} targetUid=${targetUid} role=${nextRole}`);
    if (targetUid === verifiedUser.uid && nextRole !== "owner") {
      const owners = await countOwnersFromUsersMirror();
      if (owners <= 1) return res.status(400).json({ error: "Cannot demote the last remaining owner" });
    }

    const auth = getAdminAuth();
    const authUser = await auth.getUser(targetUid);
    const oldClaimsRaw = authUser.customClaims || {};
    const oldRole = normalizeRoleFromClaims(oldClaimsRaw);
    const oldPermissions = sanitizePermissionSet(oldClaimsRaw.permissions, oldRole);
    const nextPermissions = defaultPermissionsForRole(nextRole);
    if (oldRole === "owner" && nextRole !== "owner") {
      const owners = await countOwnersFromUsersMirror();
      if (owners <= 1) return res.status(400).json({ error: "Cannot demote the last remaining owner" });
    }
    if (callerRole !== "owner" && oldRole === "owner") {
      return res.status(403).json({ error: "Only owners can modify owner accounts" });
    }

    const nextClaims: Record<string, unknown> = { ...oldClaimsRaw, role: nextRole, permissions: nextPermissions };
    nextClaims.admin = nextRole === "owner" || nextRole === "admin";
    await auth.setCustomUserClaims(targetUid, nextClaims);
    await auth.revokeRefreshTokens(targetUid);

    const email = authUser.email || "";
    const displayName = authUser.displayName || "";
    await firestoreCall(`users/${targetUid}`, {
      method: "PATCH",
      body: { fields: toFirestoreUserFields({ email, displayName, role: nextRole, permissions: nextPermissions, status: "active", actorUid: verifiedUser.uid }) },
    });
    await writeAuditLog({
      actorUid: verifiedUser.uid,
      actorEmail: verifiedUser.email || "",
      targetUid,
      targetEmail: email,
      action: "set-role",
      oldRole,
      newRole: nextRole,
      metadata: { oldPermissions, nextPermissions },
    });
    await pause(120);
    console.log(`[admin/set-role] success actorUid=${verifiedUser.uid} targetUid=${targetUid} oldRole=${oldRole} newRole=${nextRole}`);
    return res.json({ success: true, message: "Role updated. Ask the user to refresh their token (sign out/sign in)." });
  } catch (error) {
    console.error("[admin/set-role] failed", error);
    await pause(120);
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to set role" });
  }
});

app.post("/api/admin/users/:action(enable|disable)", async (req, res) => {
  try {
    const token = getBearerToken(req.headers.authorization);
    if (!token) return res.status(401).json({ error: "Authentication required" });
    const verifiedUser = await verifyFirebaseUser(token);
    if (!verifiedUser) return res.status(401).json({ error: "Invalid or expired auth token" });
    const callerRole = normalizeRoleFromClaims(verifiedUser.claims);
    const callerPermissions = sanitizePermissionSet(verifiedUser.claims.permissions, callerRole);
    if (!callerPermissions.canManageRoles) return res.status(403).json({ error: "Manage roles permission required" });
    const targetUid = typeof req.body?.uid === "string" ? req.body.uid : "";
    if (!targetUid) return res.status(400).json({ error: "uid is required" });
    const disableUser = req.params.action === "disable";

    const lookup = await identityToolkitCall("/accounts:lookup", { localId: [targetUid] });
    const authUser = ((lookup.users as Array<Record<string, unknown>> | undefined) || [])[0];
    if (!authUser) return res.status(404).json({ error: "Target user not found" });
    await identityToolkitCall("/accounts:update", { localId: targetUid, disableUser });

    const oldClaimsRaw = typeof authUser.customAttributes === "string" ? JSON.parse(authUser.customAttributes) as Record<string, unknown> : {};
    const role = normalizeRoleFromClaims(oldClaimsRaw);
    if (callerRole !== "owner" && role === "owner") {
      return res.status(403).json({ error: "Only owners can modify owner accounts" });
    }
    const permissions = sanitizePermissionSet(oldClaimsRaw.permissions, role);
    const email = String(authUser.email || "");
    const displayName = String(authUser.displayName || "");
    await firestoreCall(`users/${targetUid}`, {
      method: "PATCH",
      body: { fields: toFirestoreUserFields({ email, displayName, role, permissions, status: disableUser ? "disabled" : "active", actorUid: verifiedUser.uid }) },
    });
    await writeAuditLog({
      actorUid: verifiedUser.uid,
      actorEmail: verifiedUser.email || "",
      targetUid,
      targetEmail: email,
      action: disableUser ? "disable-user" : "enable-user",
    });
    return res.json({ success: true, message: `User ${disableUser ? "disabled" : "enabled"}. User should sign in again.` });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to update user status" });
  }
});

app.post("/api/admin/users/set-permissions", async (req, res) => {
  try {
    const token = getBearerToken(req.headers.authorization);
    if (!token) return res.status(401).json({ error: "Authentication required" });
    const verifiedUser = await verifyFirebaseUser(token);
    if (!verifiedUser) return res.status(401).json({ error: "Invalid or expired auth token" });
    const callerRole = normalizeRoleFromClaims(verifiedUser.claims);
    const callerPermissions = sanitizePermissionSet(verifiedUser.claims.permissions, callerRole);
    if (!callerPermissions.canManageRoles) return res.status(403).json({ error: "Manage roles permission required" });

    const targetUid = typeof req.body?.uid === "string" ? req.body.uid : "";
    if (!targetUid) return res.status(400).json({ error: "uid is required" });

    const auth = getAdminAuth();
    const authUser = await auth.getUser(targetUid);
    const oldClaimsRaw = authUser.customClaims || {};
    const targetRole = normalizeRoleFromClaims(oldClaimsRaw);
    if (callerRole !== "owner" && targetRole === "owner") {
      return res.status(403).json({ error: "Only owners can modify owner accounts" });
    }
    const nextPermissions = sanitizePermissionSet(req.body?.permissions, targetRole);
    const nextClaims: Record<string, unknown> = { ...oldClaimsRaw, permissions: nextPermissions };
    await auth.setCustomUserClaims(targetUid, nextClaims);
    await auth.revokeRefreshTokens(targetUid);

    const email = authUser.email || "";
    const displayName = authUser.displayName || "";
    await firestoreCall(`users/${targetUid}`, {
      method: "PATCH",
      body: { fields: toFirestoreUserFields({ email, displayName, role: targetRole, permissions: nextPermissions, status: "active", actorUid: verifiedUser.uid }) },
    });
    await writeAuditLog({
      actorUid: verifiedUser.uid,
      actorEmail: verifiedUser.email || "",
      targetUid,
      targetEmail: email,
      action: "set-permissions",
      metadata: { nextPermissions },
    });

    return res.json({ success: true, message: "Permissions updated. User should refresh access claims." });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to update permissions" });
  }
});

type ProjectSyncCandidate = {
  id: string;
  code: string;
  title: string;
  description: string;
  status: string;
  ownerName: string;
  dueDate: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

function getServiceAccountEmail(): string | null {
  try {
    return getServiceAccount().clientEmail;
  } catch {
    return null;
  }
}

function extractProjectFromFirestoreDoc(raw: Record<string, unknown>): ProjectSyncCandidate | null {
  const id = typeof raw.id === "string" ? raw.id : "";
  if (!id) return null;
  const code = typeof raw.code === "string" ? raw.code : "";
  const title = typeof raw.title === "string" ? raw.title : "";
  const description = typeof raw.description === "string" ? raw.description : "";
  const status = typeof raw.status === "string" ? raw.status : "";
  const owner = raw.owner as { name?: string } | undefined;
  const ownerName = owner?.name || "Unassigned";

  const dueDateRaw = raw.dueDate;
  const dueDate = typeof dueDateRaw === "string" && dueDateRaw.trim().length > 0 ? dueDateRaw.trim() : null;
  const createdAt = typeof raw.createdAt === "string" ? raw.createdAt : null;
  const updatedAt = typeof raw.updatedAt === "string" ? raw.updatedAt : null;

  return { id, code, title, description, status, ownerName, dueDate, createdAt, updatedAt };
}

async function fetchAllProjectsForSync(): Promise<ProjectSyncCandidate[]> {
  const results: ProjectSyncCandidate[] = [];
  let pageToken: string | undefined = undefined;
  do {
    const suffix: string = pageToken ? `?pageSize=500&pageToken=${encodeURIComponent(pageToken)}` : "?pageSize=500";
    const result = await firestoreCall(`projects${suffix}`);
    const documents = (result.documents as Array<{ name?: string; fields?: Record<string, Record<string, unknown>> }> | undefined) || [];
    for (const doc of documents) {
      const parsed = parseFirestoreDocument(doc as { name?: string; fields?: Record<string, Record<string, unknown>> });
      const candidate = extractProjectFromFirestoreDoc(parsed);
      if (candidate) results.push(candidate);
    }
    const nextPageToken = typeof result.nextPageToken === "string" ? result.nextPageToken : "";
    pageToken = nextPageToken.length > 0 ? nextPageToken : undefined;
  } while (pageToken);
  return results;
}

function normalizeDueDateForCalendar(dueDate: string): { date: string } | { dateTime: string; timeZone?: string } | null {
  const trimmed = dueDate.trim();
  if (!trimmed) return null;
  const dateOnlyMatch = /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
  if (dateOnlyMatch) {
    return { date: trimmed };
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return { dateTime: parsed.toISOString() };
}

function addOneDayToDateString(dateString: string): string {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + 1);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

type CalendarEvent = {
  id?: string;
  summary?: string;
  description?: string;
  location?: string;
  status?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
  extendedProperties?: { private?: Record<string, string> };
  htmlLink?: string;
};

async function googleApiFetch(
  url: string,
  options: {
    method?: string;
    scope: string;
    body?: unknown;
    contentType?: string;
    rawBody?: Buffer | Uint8Array | string;
    acceptJson?: boolean;
  },
): Promise<Response> {
  const token = await getGoogleAccessToken(options.scope);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };
  if (options.acceptJson !== false) {
    headers.Accept = "application/json";
  }

  let body: BodyInit | undefined;
  if (options.rawBody !== undefined) {
    headers["Content-Type"] = options.contentType || "application/octet-stream";
    body = options.rawBody as BodyInit;
  } else if (options.body !== undefined) {
    headers["Content-Type"] = options.contentType || "application/json";
    body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
  }

  return fetch(url, {
    method: options.method || "GET",
    headers,
    body,
  });
}

async function googleJsonRequest<T = Record<string, unknown>>(
  url: string,
  options: { method?: string; scope: string; body?: unknown },
): Promise<T> {
  const response = await googleApiFetch(url, options);
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json().catch(() => ({}))
    : await response.text().catch(() => "");
  if (!response.ok) {
    const message = typeof payload === "object" && payload !== null
      ? ((payload as { error?: { message?: string } }).error?.message || `Google API error ${response.status}`)
      : `Google API error ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

async function getCalendarMetadata(calendarId: string): Promise<{ id: string; summary?: string; timeZone?: string }> {
  return googleJsonRequest(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}`, {
    method: "GET",
    scope: GOOGLE_SCOPE_CALENDAR,
  });
}

async function findCalendarEventByProjectId(
  calendarId: string,
  projectId: string,
): Promise<CalendarEvent | null> {
  const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
  url.searchParams.set("privateExtendedProperty", `projectId=${projectId}`);
  url.searchParams.set("showDeleted", "false");
  url.searchParams.set("maxResults", "5");
  const data = await googleJsonRequest<{ items?: CalendarEvent[] }>(url.toString(), {
    method: "GET",
    scope: GOOGLE_SCOPE_CALENDAR,
  });
  return (data.items && data.items[0]) || null;
}

function buildCalendarEventPayload(
  project: ProjectSyncCandidate,
  timezone: string | undefined,
): CalendarEvent | null {
  if (!project.dueDate) return null;
  const start = normalizeDueDateForCalendar(project.dueDate);
  if (!start) return null;

  let end: CalendarEvent["end"];
  if ("date" in start && start.date) {
    end = { date: addOneDayToDateString(start.date) };
  } else if ("dateTime" in start && start.dateTime) {
    const endTime = new Date(new Date(start.dateTime).getTime() + 60 * 60 * 1000);
    end = { dateTime: endTime.toISOString() };
    if (timezone) {
      (end as { timeZone?: string }).timeZone = timezone;
      (start as { timeZone?: string }).timeZone = timezone;
    }
  }

  const summary = `${project.code ? `[${project.code}] ` : ""}${project.title || "Untitled project"}`;
  const description = [
    project.description || "",
    "",
    project.status ? `Stage: ${project.status}` : "",
    project.ownerName ? `Owner: ${project.ownerName}` : "",
    project.code ? `Code: ${project.code}` : "",
  ].filter(Boolean).join("\n").slice(0, 8000);

  return {
    summary: summary.slice(0, 250),
    description,
    start,
    end,
    extendedProperties: {
      private: {
        projectId: project.id,
        projectCode: project.code,
        source: "digital-archivist",
      },
    },
  };
}

type SyncOutcome = {
  projectId: string;
  code: string;
  title: string;
  action: "created" | "updated" | "skipped-no-date" | "skipped-invalid-date" | "failed";
  eventId?: string;
  htmlLink?: string;
  message?: string;
};

async function syncProjectsToCalendar(
  calendarId: string,
  timezone: string | undefined,
  projects: ProjectSyncCandidate[],
): Promise<{
  calendarId: string;
  totals: { evaluated: number; created: number; updated: number; skipped: number; failed: number };
  outcomes: SyncOutcome[];
}> {
  const outcomes: SyncOutcome[] = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const project of projects) {
    if (!project.dueDate) {
      skipped += 1;
      outcomes.push({ projectId: project.id, code: project.code, title: project.title, action: "skipped-no-date" });
      continue;
    }
    const payload = buildCalendarEventPayload(project, timezone);
    if (!payload) {
      skipped += 1;
      outcomes.push({
        projectId: project.id,
        code: project.code,
        title: project.title,
        action: "skipped-invalid-date",
        message: `Could not parse dueDate "${project.dueDate}"`,
      });
      continue;
    }

    try {
      const existing = await findCalendarEventByProjectId(calendarId, project.id);
      if (existing?.id) {
        const updatedEvent = await googleJsonRequest<CalendarEvent>(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(existing.id)}`,
          { method: "PATCH", scope: GOOGLE_SCOPE_CALENDAR, body: payload },
        );
        updated += 1;
        outcomes.push({
          projectId: project.id,
          code: project.code,
          title: project.title,
          action: "updated",
          eventId: updatedEvent.id,
          htmlLink: updatedEvent.htmlLink,
        });
      } else {
        const createdEvent = await googleJsonRequest<CalendarEvent>(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
          { method: "POST", scope: GOOGLE_SCOPE_CALENDAR, body: payload },
        );
        created += 1;
        outcomes.push({
          projectId: project.id,
          code: project.code,
          title: project.title,
          action: "created",
          eventId: createdEvent.id,
          htmlLink: createdEvent.htmlLink,
        });
      }
    } catch (error) {
      failed += 1;
      outcomes.push({
        projectId: project.id,
        code: project.code,
        title: project.title,
        action: "failed",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return {
    calendarId,
    totals: { evaluated: projects.length, created, updated, skipped, failed },
    outcomes,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeDriveMetadata(input: unknown, allowedKeys: string[]): Record<string, unknown> | null {
  if (!isPlainObject(input)) return null;
  const output: Record<string, unknown> = {};
  for (const key of allowedKeys) {
    if (!(key in input)) continue;
    const value = input[key];
    if (key === "parents") {
      if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.length === 0 || entry.length > GOOGLE_DRIVE_ID_MAX_LENGTH)) {
        return null;
      }
      output.parents = value;
      continue;
    }
    if (key === "properties" || key === "appProperties") {
      if (!isPlainObject(value)) return null;
      const entries = Object.entries(value);
      if (entries.length > 30) return null;
      const cleaned: Record<string, string> = {};
      for (const [k, v] of entries) {
        if (typeof k !== "string" || k.length === 0 || k.length > 124) return null;
        if (typeof v !== "string" || v.length > 124) return null;
        cleaned[k] = v;
      }
      output[key] = cleaned;
      continue;
    }
    if (typeof value !== "string" || value.length > 1000) return null;
    output[key] = value;
  }
  return output;
}

async function checkIntegrationsRateLimit(userId: string, ip: string): Promise<boolean> {
  const result = await checkRateLimitDistributed(`${userId}:${ip}`, {
    maxRequests: INTEGRATIONS_RATE_LIMIT_MAX_REQUESTS,
    windowMs: INTEGRATIONS_RATE_LIMIT_WINDOW_MS,
    namespace: "admin-integrations-rate-limit",
  });
  return result.allowed;
}

async function requireAdminOrOwner(req: express.Request, res: express.Response): Promise<VerifiedUser | null> {
  const token = getBearerToken(req.headers.authorization);
  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return null;
  }
  const verifiedUser = await verifyFirebaseUser(token);
  if (!verifiedUser) {
    res.status(401).json({ error: "Invalid or expired auth token" });
    return null;
  }
  const adminGate = requireInternalAdmin(verifiedUser);
  if (adminGate.ok === false) {
    res.status(adminGate.status).json({ error: adminGate.error });
    return null;
  }
  if (!await checkIntegrationsRateLimit(verifiedUser.uid, getClientIp(req))) {
    res.status(429).json({ error: "Rate limit exceeded. Please wait and try again." });
    return null;
  }
  return verifiedUser;
}

app.get("/api/admin/integrations/status", async (req, res) => {
  try {
    const verifiedUser = await requireAdminOrOwner(req, res);
    if (!verifiedUser) return;
    const settings = await fetchFirestoreSettings();
    return res.json({
      serviceAccountEmail: getServiceAccountEmail(),
      calendar: {
        enabled: settings.googleCalendarEnabled === true,
        calendarId: settings.googleCalendarId || "",
        calendarUrl: settings.googleCalendarUrl || "",
        timezone: settings.googleCalendarTimezone || "",
      },
      drive: {
        enabled: settings.googleDriveEnabled === true,
        driveId: settings.googleDriveId || "",
        driveUrl: settings.googleDriveUrl || "",
        folderId: settings.googleDriveFolderId || "",
      },
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to read integration status" });
  }
});

app.post("/api/admin/calendar/test", async (req, res) => {
  const requestId = randomUUID();
  try {
    const verifiedUser = await requireAdminOrOwner(req, res);
    if (!verifiedUser) return;
    const settings = await fetchFirestoreSettings();
    const calendarId = (settings.googleCalendarId || "").trim();
    if (!calendarId) return res.status(400).json({ error: "No calendar is configured in settings." });

    const metadata = await withTimeout(
      getCalendarMetadata(calendarId),
      INTEGRATIONS_TIMEOUT_MS,
      "Calendar request timed out",
    );
    auditLog("admin_calendar_test_ok", {
      requestId,
      actorUid: verifiedUser.uid,
      actorEmail: verifiedUser.email,
      calendarId,
    });
    return res.json({
      ok: true,
      calendarId: metadata.id,
      summary: metadata.summary || null,
      timezone: metadata.timeZone || null,
      serviceAccountEmail: getServiceAccountEmail(),
    });
  } catch (error) {
    auditLog("admin_calendar_test_failed", {
      requestId,
      message: error instanceof Error ? error.message : "unknown",
    }, "error");
    return res.status(502).json({
      error: error instanceof Error ? error.message : "Unable to reach Google Calendar",
      serviceAccountEmail: getServiceAccountEmail(),
    });
  }
});

app.post("/api/admin/calendar/sync", async (req, res) => {
  const requestId = randomUUID();
  const clientIp = getClientIp(req);
  try {
    const verifiedUser = await requireAdminOrOwner(req, res);
    if (!verifiedUser) return;
    const settings = await fetchFirestoreSettings();
    if (settings.googleCalendarEnabled !== true) {
      return res.status(400).json({ error: "Calendar integration is disabled in settings." });
    }
    const calendarId = (settings.googleCalendarId || "").trim();
    if (!calendarId) return res.status(400).json({ error: "No calendar is configured in settings." });

    const projectIdFilter = typeof req.body?.projectId === "string" ? req.body.projectId.trim() : "";

    const projects = await withTimeout(
      fetchAllProjectsForSync(),
      INTEGRATIONS_TIMEOUT_MS,
      "Calendar sync fetch timed out",
    );
    const targetProjects = projectIdFilter ? projects.filter((p) => p.id === projectIdFilter) : projects;

    const report = await withTimeout(
      syncProjectsToCalendar(calendarId, settings.googleCalendarTimezone, targetProjects),
      INTEGRATIONS_TIMEOUT_MS * 2,
      "Calendar sync timed out",
    );

    auditLog("admin_calendar_sync_completed", {
      requestId,
      actorUid: verifiedUser.uid,
      actorEmail: verifiedUser.email,
      ip: clientIp,
      calendarId,
      totals: report.totals,
      scope: projectIdFilter ? "single" : "all",
    });
    return res.json(report);
  } catch (error) {
    auditLog("admin_calendar_sync_failed", {
      requestId,
      message: error instanceof Error ? error.message : "unknown",
    }, "error");
    return res.status(502).json({ error: error instanceof Error ? error.message : "Unable to sync calendar" });
  }
});

app.get("/api/admin/drive/files", async (req, res) => {
  try {
    const verifiedUser = await requireAdminOrOwner(req, res);
    if (!verifiedUser) return;
    const settings = await fetchFirestoreSettings();
    const driveId = (settings.googleDriveId || "").trim();
    if (!driveId) return res.status(400).json({ error: "No shared drive is configured in settings." });

    const pageSizeRaw = typeof req.query.pageSize === "string" ? Number(req.query.pageSize) : 50;
    const pageSize = Number.isInteger(pageSizeRaw) && pageSizeRaw > 0 && pageSizeRaw <= 200 ? pageSizeRaw : 50;
    const pageToken = typeof req.query.pageToken === "string" && req.query.pageToken.length < 2000 ? req.query.pageToken : "";
    const q = typeof req.query.q === "string" && req.query.q.length < 500 ? req.query.q : "";
    const folderId = typeof req.query.folderId === "string" && GOOGLE_RESOURCE_ID_PATTERN.test(req.query.folderId)
      ? req.query.folderId
      : "";
    const defaultFolder = (settings.googleDriveFolderId || "").trim();

    const url = new URL("https://www.googleapis.com/drive/v3/files");
    url.searchParams.set("corpora", "drive");
    url.searchParams.set("driveId", driveId);
    url.searchParams.set("includeItemsFromAllDrives", "true");
    url.searchParams.set("supportsAllDrives", "true");
    url.searchParams.set("pageSize", String(pageSize));
    url.searchParams.set(
      "fields",
      "nextPageToken,files(id,name,mimeType,parents,modifiedTime,size,webViewLink,iconLink,trashed,owners(displayName,emailAddress))",
    );
    const effectiveFolder = folderId || defaultFolder;
    const qClauses: string[] = [];
    if (effectiveFolder) qClauses.push(`'${effectiveFolder.replace(/'/g, "\\'")}' in parents`);
    if (q) qClauses.push(q);
    qClauses.push("trashed = false");
    url.searchParams.set("q", qClauses.join(" and "));
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const data = await withTimeout(
      googleJsonRequest<{ files?: unknown[]; nextPageToken?: string }>(url.toString(), {
        method: "GET",
        scope: GOOGLE_SCOPE_DRIVE,
      }),
      INTEGRATIONS_TIMEOUT_MS,
      "Drive list timed out",
    );
    return res.json({ files: data.files || [], nextPageToken: data.nextPageToken || null });
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : "Unable to list drive files" });
  }
});

app.get("/api/admin/drive/files/:fileId", async (req, res) => {
  try {
    const verifiedUser = await requireAdminOrOwner(req, res);
    if (!verifiedUser) return;
    const settings = await fetchFirestoreSettings();
    if (!(settings.googleDriveId || "").trim()) {
      return res.status(400).json({ error: "No shared drive is configured in settings." });
    }
    const fileId = req.params.fileId;
    if (!GOOGLE_RESOURCE_ID_PATTERN.test(fileId)) return res.status(400).json({ error: "Invalid file id" });
    const download = req.query.alt === "media";

    if (download) {
      const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;
      const response = await googleApiFetch(url, { method: "GET", scope: GOOGLE_SCOPE_DRIVE, acceptJson: false });
      if (!response.ok) {
        const message = await response.text().catch(() => "");
        return res.status(response.status).json({ error: message || `Drive download error ${response.status}` });
      }
      const contentType = response.headers.get("content-type") || "application/octet-stream";
      const contentLength = response.headers.get("content-length");
      res.setHeader("Content-Type", contentType);
      if (contentLength) res.setHeader("Content-Length", contentLength);
      const arrayBuffer = await response.arrayBuffer();
      return res.send(Buffer.from(arrayBuffer));
    }

    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=id,name,mimeType,parents,modifiedTime,size,webViewLink,webContentLink,iconLink,trashed,owners(displayName,emailAddress)`;
    const data = await withTimeout(
      googleJsonRequest(url, { method: "GET", scope: GOOGLE_SCOPE_DRIVE }),
      INTEGRATIONS_TIMEOUT_MS,
      "Drive get timed out",
    );
    return res.json(data);
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : "Unable to get drive file" });
  }
});

const ALLOWED_DRIVE_METADATA_KEYS = [
  "name",
  "mimeType",
  "description",
  "parents",
  "starred",
  "properties",
  "appProperties",
];

app.post("/api/admin/drive/files", express.json({ limit: `${DRIVE_UPLOAD_MAX_BYTES}b` }), async (req, res) => {
  try {
    const verifiedUser = await requireAdminOrOwner(req, res);
    if (!verifiedUser) return;
    const settings = await fetchFirestoreSettings();
    const driveId = (settings.googleDriveId || "").trim();
    if (!driveId) return res.status(400).json({ error: "No shared drive is configured in settings." });

    const metadataInput = sanitizeDriveMetadata(req.body?.metadata, ALLOWED_DRIVE_METADATA_KEYS);
    if (!metadataInput) return res.status(400).json({ error: "Invalid metadata payload" });
    if (typeof metadataInput.name !== "string" || metadataInput.name.length === 0) {
      return res.status(400).json({ error: "metadata.name is required" });
    }

    if (!metadataInput.parents) {
      const defaultFolder = (settings.googleDriveFolderId || "").trim() || driveId;
      metadataInput.parents = [defaultFolder];
    }

    const contentBase64 = typeof req.body?.contentBase64 === "string" ? req.body.contentBase64 : "";
    const contentMimeType = typeof req.body?.contentMimeType === "string" ? req.body.contentMimeType : "application/octet-stream";

    let createdFile: Record<string, unknown>;
    if (contentBase64) {
      const buffer = Buffer.from(contentBase64, "base64");
      if (buffer.length > DRIVE_UPLOAD_MAX_BYTES) {
        return res.status(413).json({ error: "File exceeds maximum upload size" });
      }
      const boundary = `----archivist-${randomUUID()}`;
      const metadataPart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadataInput)}\r\n`;
      const fileHeader = `--${boundary}\r\nContent-Type: ${contentMimeType}\r\nContent-Transfer-Encoding: base64\r\n\r\n`;
      const footer = `\r\n--${boundary}--`;
      const body = Buffer.concat([
        Buffer.from(metadataPart, "utf8"),
        Buffer.from(fileHeader, "utf8"),
        Buffer.from(contentBase64, "utf8"),
        Buffer.from(footer, "utf8"),
      ]);
      const url = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,mimeType,parents,modifiedTime,size,webViewLink";
      const response = await googleApiFetch(url, {
        method: "POST",
        scope: GOOGLE_SCOPE_DRIVE,
        rawBody: body,
        contentType: `multipart/related; boundary=${boundary}`,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        return res.status(response.status).json({
          error: (payload as { error?: { message?: string } }).error?.message || `Drive upload error ${response.status}`,
        });
      }
      createdFile = payload as Record<string, unknown>;
    } else {
      if (Buffer.byteLength(JSON.stringify(metadataInput), "utf8") > DRIVE_METADATA_MAX_BYTES) {
        return res.status(413).json({ error: "Metadata payload too large" });
      }
      const url = "https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id,name,mimeType,parents,modifiedTime,webViewLink";
      createdFile = await googleJsonRequest<Record<string, unknown>>(url, {
        method: "POST",
        scope: GOOGLE_SCOPE_DRIVE,
        body: metadataInput,
      });
    }

    auditLog("admin_drive_file_created", {
      actorUid: verifiedUser.uid,
      actorEmail: verifiedUser.email,
      fileId: createdFile.id,
      name: metadataInput.name,
    });
    return res.status(201).json(createdFile);
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : "Unable to create drive file" });
  }
});

app.put("/api/admin/drive/files/:fileId", express.json({ limit: `${DRIVE_UPLOAD_MAX_BYTES}b` }), async (req, res) => {
  try {
    const verifiedUser = await requireAdminOrOwner(req, res);
    if (!verifiedUser) return;
    const settings = await fetchFirestoreSettings();
    if (!(settings.googleDriveId || "").trim()) {
      return res.status(400).json({ error: "No shared drive is configured in settings." });
    }
    const fileId = req.params.fileId;
    if (!GOOGLE_RESOURCE_ID_PATTERN.test(fileId)) return res.status(400).json({ error: "Invalid file id" });

    const metadataInput = req.body?.metadata !== undefined
      ? sanitizeDriveMetadata(req.body.metadata, ALLOWED_DRIVE_METADATA_KEYS.filter((key) => key !== "parents"))
      : {};
    if (metadataInput === null) return res.status(400).json({ error: "Invalid metadata payload" });

    const addParents = typeof req.body?.addParents === "string" && GOOGLE_RESOURCE_ID_PATTERN.test(req.body.addParents)
      ? req.body.addParents
      : "";
    const removeParents = typeof req.body?.removeParents === "string" && GOOGLE_RESOURCE_ID_PATTERN.test(req.body.removeParents)
      ? req.body.removeParents
      : "";

    const contentBase64 = typeof req.body?.contentBase64 === "string" ? req.body.contentBase64 : "";
    const contentMimeType = typeof req.body?.contentMimeType === "string" ? req.body.contentMimeType : "application/octet-stream";

    let updatedFile: Record<string, unknown>;
    const fieldsParam = "id,name,mimeType,parents,modifiedTime,size,webViewLink";

    if (contentBase64) {
      const buffer = Buffer.from(contentBase64, "base64");
      if (buffer.length > DRIVE_UPLOAD_MAX_BYTES) {
        return res.status(413).json({ error: "File exceeds maximum upload size" });
      }
      const boundary = `----archivist-${randomUUID()}`;
      const metadataPart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadataInput || {})}\r\n`;
      const fileHeader = `--${boundary}\r\nContent-Type: ${contentMimeType}\r\nContent-Transfer-Encoding: base64\r\n\r\n`;
      const footer = `\r\n--${boundary}--`;
      const body = Buffer.concat([
        Buffer.from(metadataPart, "utf8"),
        Buffer.from(fileHeader, "utf8"),
        Buffer.from(contentBase64, "utf8"),
        Buffer.from(footer, "utf8"),
      ]);
      const url = new URL(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}`);
      url.searchParams.set("uploadType", "multipart");
      url.searchParams.set("supportsAllDrives", "true");
      url.searchParams.set("fields", fieldsParam);
      if (addParents) url.searchParams.set("addParents", addParents);
      if (removeParents) url.searchParams.set("removeParents", removeParents);
      const response = await googleApiFetch(url.toString(), {
        method: "PATCH",
        scope: GOOGLE_SCOPE_DRIVE,
        rawBody: body,
        contentType: `multipart/related; boundary=${boundary}`,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        return res.status(response.status).json({
          error: (payload as { error?: { message?: string } }).error?.message || `Drive update error ${response.status}`,
        });
      }
      updatedFile = payload as Record<string, unknown>;
    } else {
      if (Object.keys(metadataInput || {}).length === 0 && !addParents && !removeParents) {
        return res.status(400).json({ error: "No updates supplied" });
      }
      const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
      url.searchParams.set("supportsAllDrives", "true");
      url.searchParams.set("fields", fieldsParam);
      if (addParents) url.searchParams.set("addParents", addParents);
      if (removeParents) url.searchParams.set("removeParents", removeParents);
      updatedFile = await googleJsonRequest<Record<string, unknown>>(url.toString(), {
        method: "PATCH",
        scope: GOOGLE_SCOPE_DRIVE,
        body: metadataInput || {},
      });
    }

    auditLog("admin_drive_file_updated", {
      actorUid: verifiedUser.uid,
      actorEmail: verifiedUser.email,
      fileId,
    });
    return res.json(updatedFile);
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : "Unable to update drive file" });
  }
});

app.delete("/api/admin/drive/files/:fileId", async (req, res) => {
  try {
    const verifiedUser = await requireAdminOrOwner(req, res);
    if (!verifiedUser) return;
    const settings = await fetchFirestoreSettings();
    if (!(settings.googleDriveId || "").trim()) {
      return res.status(400).json({ error: "No shared drive is configured in settings." });
    }
    const fileId = req.params.fileId;
    if (!GOOGLE_RESOURCE_ID_PATTERN.test(fileId)) return res.status(400).json({ error: "Invalid file id" });

    const response = await googleApiFetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`,
      { method: "DELETE", scope: GOOGLE_SCOPE_DRIVE, acceptJson: false },
    );
    if (!response.ok && response.status !== 204) {
      const message = await response.text().catch(() => "");
      return res.status(response.status).json({ error: message || `Drive delete error ${response.status}` });
    }
    auditLog("admin_drive_file_deleted", {
      actorUid: verifiedUser.uid,
      actorEmail: verifiedUser.email,
      fileId,
    });
    return res.status(204).send();
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : "Unable to delete drive file" });
  }
});

// Translate body-parser failures (oversized JSON, malformed JSON) into structured 4xx responses
// so the Settings view shows a helpful message instead of a generic 500. Registered after all
// routes so it runs for any express next(err) call.
app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  const asRecord = err as { type?: string; status?: number; message?: string } | null;
  if (asRecord && (asRecord.type === "entity.too.large" || asRecord.status === 413)) {
    res.status(413).json({
      error: "Request body too large. If you uploaded a large logo, try a smaller image or compress it before saving.",
    });
    return;
  }
  if (asRecord && asRecord.type === "entity.parse.failed") {
    res.status(400).json({ error: "Request body is not valid JSON." });
    return;
  }
  if (res.headersSent) {
    next(err);
    return;
  }
  console.error("Unhandled express error", err);
  res.status(500).json({ error: "Unexpected server error." });
});

export default app;

if (!isVercel) {
  void (async () => {
    if (!isProduction) {
      const { createServer: createViteServer } = await import("vite");
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } else {
      const distPath = path.join(process.cwd(), "dist");
      app.use(express.static(distPath));
      const indexPath = path.join(distPath, "index.html");
      app.get("*", (_req, res) => {
        void (async () => {
          try {
            const indexHtml = await readFile(indexPath, "utf8");
            const runtimeEnv = CLIENT_FIREBASE_ENV_KEYS.reduce<Record<string, string>>((acc, key) => {
              const value = process.env[key];
              if (value && value.trim().length > 0) {
                acc[key] = value;
              }
              return acc;
            }, {});
            const runtimeScript = `<script>window.__APP_ENV__=${JSON.stringify(runtimeEnv)};</script>`;
            const html = indexHtml.includes("</head>")
              ? indexHtml.replace("</head>", `${runtimeScript}</head>`)
              : `${runtimeScript}${indexHtml}`;
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            res.send(html);
          } catch (error: unknown) {
            console.error("Failed to render index.html with runtime env", error);
            res.status(500).send("Unable to load app shell.");
          }
        })();
      });
    }

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  })();
}
