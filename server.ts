import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { readFile } from "node:fs/promises";
import { createSign, randomUUID } from "node:crypto";
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
if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  console.warn("FIREBASE_SERVICE_ACCOUNT_JSON not set; Firebase Admin SDK disabled.");
} else {
  try {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON) as {
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
    console.error("Failed to initialize Firebase Admin SDK:", error);
  }
}

const ALLOWED_PROVIDERS = new Set(["gemini", "openai", "anthropic", "gemma"]);
const AI_RATE_LIMIT_WINDOW_MS = 60_000;
const AI_RATE_LIMIT_MAX_REQUESTS = 20;
const allowedOrigins = getAllowedCorsOrigins();
const devOrigins = ["http://localhost:3000", "http://127.0.0.1:3000"];
const ADMIN_SETTINGS_RATE_LIMIT_WINDOW_MS = 60_000;
const ADMIN_SETTINGS_RATE_LIMIT_MAX_REQUESTS = 15;
const ADMIN_OPERATIONS_RATE_LIMIT_WINDOW_MS = 60_000;
const ADMIN_OPERATIONS_RATE_LIMIT_MAX_REQUESTS = 6;
const ADMIN_SETTINGS_MAX_BODY_BYTES = 8 * 1024;
const ADMIN_OPERATIONS_MAX_BODY_BYTES = 2 * 1024;
const ADMIN_SETTINGS_TIMEOUT_MS = 8_000;
const ADMIN_OPERATIONS_TIMEOUT_MS = 15_000;
const MAX_PROMPT_LENGTH = 4_000;
const MAX_SYSTEM_INSTRUCTION_LENGTH = 2_000;
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
  aiNextBestActionEnabled: boolean;
  aiRiskNarrativeEnabled: boolean;
  aiDuplicateDetectionEnabled: boolean;
  aiRequireHumanApproval: boolean;
  privacyMode: "public-read" | "private-read";
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
  if (!isInternalUser(user.claims)) {
    return { ok: false, status: 403, error: "Internal domain/group authorization required" };
  }
  const role = normalizeRoleFromClaims(user.claims);
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

async function verifyFirebaseUser(idToken: string): Promise<VerifiedUser | null> {
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

function validateSettings(input: unknown): AppSettings | null {
  if (!input || typeof input !== "object") return null;
  const source = input as Record<string, unknown>;

  if (
    typeof source.aiEnabled !== "boolean" ||
    typeof source.aiNextBestActionEnabled !== "boolean" ||
    typeof source.aiRiskNarrativeEnabled !== "boolean" ||
    typeof source.aiDuplicateDetectionEnabled !== "boolean" ||
    typeof source.aiRequireHumanApproval !== "boolean" ||
    typeof source.activeProvider !== "string" ||
    !ALLOWED_PROVIDERS.has(source.activeProvider) ||
    (source.privacyMode !== "public-read" && source.privacyMode !== "private-read")
  ) {
    return null;
  }

  return {
    aiEnabled: source.aiEnabled,
    activeProvider: source.activeProvider,
    aiNextBestActionEnabled: source.aiNextBestActionEnabled,
    aiRiskNarrativeEnabled: source.aiRiskNarrativeEnabled,
    aiDuplicateDetectionEnabled: source.aiDuplicateDetectionEnabled,
    aiRequireHumanApproval: source.aiRequireHumanApproval,
    privacyMode: source.privacyMode,
  };
}

function toFirestoreFields(settings: AppSettings): Record<string, { stringValue?: string; booleanValue?: boolean }> {
  return {
    aiEnabled: { booleanValue: settings.aiEnabled },
    activeProvider: { stringValue: settings.activeProvider },
    aiNextBestActionEnabled: { booleanValue: settings.aiNextBestActionEnabled },
    aiRiskNarrativeEnabled: { booleanValue: settings.aiRiskNarrativeEnabled },
    aiDuplicateDetectionEnabled: { booleanValue: settings.aiDuplicateDetectionEnabled },
    aiRequireHumanApproval: { booleanValue: settings.aiRequireHumanApproval },
    privacyMode: { stringValue: settings.privacyMode },
  };
}

function fromFirestoreFields(
  fields: Record<string, { stringValue?: string; booleanValue?: boolean }> | undefined,
): Partial<AppSettings> {
  if (!fields) return {};
  return {
    aiEnabled: fields.aiEnabled?.booleanValue,
    activeProvider: fields.activeProvider?.stringValue,
    aiNextBestActionEnabled: fields.aiNextBestActionEnabled?.booleanValue,
    aiRiskNarrativeEnabled: fields.aiRiskNarrativeEnabled?.booleanValue,
    aiDuplicateDetectionEnabled: fields.aiDuplicateDetectionEnabled?.booleanValue,
    aiRequireHumanApproval: fields.aiRequireHumanApproval?.booleanValue,
    privacyMode: fields.privacyMode?.stringValue as AppSettings["privacyMode"] | undefined,
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
  const parsed = JSON.parse(raw) as { client_email?: string; private_key?: string };
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is missing client_email/private_key");
  }
  return {
    clientEmail: parsed.client_email,
    privateKey: parsed.private_key.replace(/\\n/g, "\n"),
  };
}

async function getGoogleAccessToken(scope = "https://www.googleapis.com/auth/cloud-platform"): Promise<string> {
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

async function firestoreCall(path: string, options: { method?: string; body?: unknown } = {}): Promise<Record<string, unknown>> {
  const token = await getGoogleAccessToken("https://www.googleapis.com/auth/datastore");
  const projectId = getFirebaseProjectId();
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${path}`, {
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

async function fetchFirestoreSettings(idToken: string): Promise<Partial<AppSettings>> {
  const projectId = process.env.VITE_FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error("VITE_FIREBASE_PROJECT_ID is not configured on the server");

  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/settings/global`,
    { headers: { Authorization: `Bearer ${idToken}` } },
  );

  if (response.status === 404) return {};
  if (!response.ok) throw new Error("Unable to read settings document for auditing");

  const documentData = (await response.json()) as {
    fields?: Record<string, { stringValue?: string; booleanValue?: boolean }>;
  };
  return fromFirestoreFields(documentData.fields);
}

async function saveFirestoreSettings(idToken: string, settings: AppSettings): Promise<void> {
  const projectId = process.env.VITE_FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error("VITE_FIREBASE_PROJECT_ID is not configured on the server");

  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/settings/global`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${idToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fields: toFirestoreFields(settings) }),
    },
  );

  if (!response.ok) {
    throw new Error("Unable to write settings document");
  }
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
  return (process.env.OWNER_EMAILS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function isEmailEligibleForOwnerBootstrap(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  return configuredOwnerEmails().includes(normalized);
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

  if (input.actorUid && input.actorEmail) {
    await writeAuditLog({
      actorUid: input.actorUid,
      actorEmail: input.actorEmail,
      targetUid: input.uid,
      targetEmail: input.email,
      action: input.action,
      oldRole,
      newRole: "owner",
    });
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
app.use(express.json({ limit: "16kb" }));
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
let bootstrapPromise: Promise<void> | null = null;
function ensureBootstrap(): Promise<void> {
  if (!bootstrapPromise) {
    bootstrapPromise = bootstrapOwnersFromEnv();
  }
  return bootstrapPromise;
}
app.use("/api", (_req, _res, next) => {
  void ensureBootstrap()
    .then(() => next())
    .catch((error) => {
      console.error("Failed to bootstrap owners from env", error);
      next();
    });
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.post("/api/auth/reconcile-role", async (req, res) => {
  try {
    const token = getBearerToken(req.headers.authorization);
    if (!token) return res.status(401).json({ error: "Authentication required" });
    const verifiedUser = await verifyFirebaseUser(token);
    if (!verifiedUser) return res.status(401).json({ error: "Invalid or expired auth token" });
    console.log(`[auth/reconcile-role] started uid=${verifiedUser.uid} email=${verifiedUser.email || "unknown"}`);

    const currentRole = normalizeRoleFromClaims(verifiedUser.claims);

    if (currentRole !== "owner" && isEmailEligibleForOwnerBootstrap(verifiedUser.email)) {
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

    await pause(120);
    console.log(`[auth/reconcile-role] no-op uid=${verifiedUser.uid} role=${currentRole}`);
    return res.json({ role: currentRole, reconciled: false });
  } catch (error) {
    console.error("[auth/reconcile-role] failed", error);
    await pause(120);
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to reconcile role" });
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

    const { prompt, provider, model, systemInstruction } = req.body;

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
      fetchFirestoreSettings(token),
      ADMIN_SETTINGS_TIMEOUT_MS,
      "Settings request timed out",
    );
    await withTimeout(
      saveFirestoreSettings(token, nextSettings),
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
    auditLog("admin_settings_update_failed", {
      requestId,
      message: error instanceof Error ? error.message : "Unknown server error",
      ip: clientIp,
    }, "error");
    res.status(500).json({ error: "Unable to save settings right now. Please try again later." });
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

    const ownerCount = await countOwnersFromUsersMirror();
    const ownerEmails = configuredOwnerEmails();
    const eligible = ownerCount === 0 && isEmailEligibleForOwnerBootstrap(verifiedUser.email);
    return res.json({
      ownerCount,
      configured: ownerEmails.length > 0,
      eligible,
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

    if (!isEmailEligibleForOwnerBootstrap(verifiedUser.email)) {
      return res.status(403).json({ error: "Signed-in email is not configured for owner bootstrap" });
    }

    const ownerCount = await countOwnersFromUsersMirror();
    if (ownerCount > 0) {
      return res.status(409).json({ error: "Owner already exists. Use Access Management for role changes." });
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
