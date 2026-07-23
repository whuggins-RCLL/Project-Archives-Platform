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
const AI_FEATURE_KEYS = new Set(["autoTag", "summarize", "nextBestAction", "riskNarrative", "pmApproach", "publicNarrative"]);
const AI_RATE_LIMIT_WINDOW_MS = 60_000;
const AI_RATE_LIMIT_MAX_REQUESTS = 20;
const PUBLIC_NARRATIVE_MAX_PROJECTS = 24;
const PUBLIC_NARRATIVE_MAX_CONTEXT_CHARS = 3_300;
const allowedOrigins = getAllowedCorsOrigins();
const devOrigins = ["http://localhost:3000", "http://127.0.0.1:3000"];
const ADMIN_SETTINGS_RATE_LIMIT_WINDOW_MS = 60_000;
const ADMIN_SETTINGS_RATE_LIMIT_MAX_REQUESTS = 15;
const ADMIN_OPERATIONS_RATE_LIMIT_WINDOW_MS = 60_000;
const ADMIN_OPERATIONS_RATE_LIMIT_MAX_REQUESTS = 6;
/** Must fit a max-size logoDataUrl (~150k) plus an optional hero image (~600k) and other fields; was 8kb and caused 500s on save (entity too large). */
const ADMIN_SETTINGS_MAX_BODY_BYTES = 900 * 1024;
/** Max length for the optional public hero background image data URL. Kept well under Firestore's 1MB document limit alongside the logo. */
const HERO_IMAGE_MAX_LENGTH = 600_000;
const ADMIN_OPERATIONS_MAX_BODY_BYTES = 2 * 1024;
const ADMIN_SETTINGS_TIMEOUT_MS = 20_000;
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
  enabledProviders: string[];
  aiAutoTagEnabled: boolean;
  aiSummarizeEnabled: boolean;
  aiNextBestActionEnabled: boolean;
  aiRiskNarrativeEnabled: boolean;
  aiDuplicateDetectionEnabled: boolean;
  aiPmApproachEnabled: boolean;
  aiRequireHumanApproval: boolean;
  privacyMode: "public-read" | "private-read";
  publicLayout?: "standard" | "embed";
  embedShowLogo?: boolean;
  suiteName: string;
  portalName: string;
  logoDataUrl: string;
  heroImageDataUrl?: string;
  primaryColor: string;
  brandDarkColor: string;
  customFooter?: string;
  showFooter?: boolean;
  helpContactEmail?: string;
  googleDriveFolderBaseUrl?: string;
  googleCalendarId?: string;
  heroQuickLinks?: Array<{ id: string; label: string; url: string }>;
  heroNarrativeDraft?: string;
  heroNarrativePublished?: string;
};

type VerifiedUser = {
  uid: string;
  email: string | null;
  claims: Record<string, unknown>;
};

type AppRole = "owner" | "admin" | "collaborator" | "viewer";
type UserPermissionKey = "canManageRoles" | "canManageSettings" | "canEditContent" | "canViewInternalStats";
type UserPermissionSet = Record<UserPermissionKey, boolean>;
const ROLE_PRIORITY: Record<AppRole, number> = {
  owner: 4,
  admin: 3,
  collaborator: 2,
  viewer: 1,
};

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
const ELEVATED_ACCESS_INITIAL_PASSWORD_ENV = "ELEVATED_ACCESS_INITIAL_PASSWORD";

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

function selectMostPrivilegedRole(...roles: Array<AppRole | null | undefined>): AppRole {
  let resolved: AppRole = "viewer";
  for (const role of roles) {
    if (!role) continue;
    if (ROLE_PRIORITY[role] > ROLE_PRIORITY[resolved]) {
      resolved = role;
    }
  }
  return resolved;
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

function permissionClaimIsTrue(claims: Record<string, unknown>, key: UserPermissionKey): boolean {
  const perms = claims.permissions;
  if (!perms || typeof perms !== "object") return false;
  return (perms as Record<string, unknown>)[key] === true;
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

/**
 * Global settings and related admin APIs: align with `firestore.rules` `canManageSettings()` — owner/admin
 * or explicit canManageSettings on the user mirror and/or ID token. Do **not** require org/domain/group
 * flags (that blocked legitimate admins when deploying outside the original internal domain).
 */
async function requireCanManageGlobalSettings(
  user: VerifiedUser,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const mirror = await getUserMirrorRoleAndPermissions(user.uid);
  const roleFromToken = normalizeRoleFromClaims(user.claims);
  const role = selectMostPrivilegedRole(mirror.role, roleFromToken);
  if (isAdminRole(role)) {
    return { ok: true };
  }
  if (mirror.permissions?.canManageSettings) {
    return { ok: true };
  }
  if (permissionClaimIsTrue(user.claims, "canManageSettings")) {
    return { ok: true };
  }
  return { ok: false, status: 403, error: "Owner, admin, or settings management permission required" };
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
  const inMemory = (): { allowed: boolean; retryAfterSeconds: number } => ({
    allowed: checkRateLimit(`${namespace}:${key}`, maxRequests, windowMs),
    retryAfterSeconds: Math.ceil(windowMs / 1000),
  });
  if (!hasUpstash) {
    return inMemory();
  }

  try {
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
    const incrData = (await safeJson(incrResponse)) as { result?: number };
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
  } catch (err) {
    console.error("Upstash distributed rate limit failed; using in-memory limiter:", err);
    return inMemory();
  }
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

async function safeJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
}

/**
 * Attempts to extract the upstream HTTP status code from a provider SDK error.
 * OpenAI/Anthropic SDK errors expose a numeric `status`; @google/genai serializes
 * the upstream error as JSON in the message (e.g. {"error":{"code":429,...}}).
 */
function extractProviderStatus(error: unknown): number | null {
  if (error && typeof error === "object") {
    const maybe = error as { status?: unknown; statusCode?: unknown };
    if (typeof maybe.status === "number" && Number.isFinite(maybe.status)) {
      return maybe.status;
    }
    if (typeof maybe.statusCode === "number" && Number.isFinite(maybe.statusCode)) {
      return maybe.statusCode;
    }
  }

  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (!message) return null;

  try {
    const parsed = JSON.parse(message) as { error?: { code?: unknown } };
    const code = parsed?.error?.code;
    if (typeof code === "number" && Number.isFinite(code)) {
      return code;
    }
  } catch {
    // message is not JSON; fall through to regex matching
  }

  const codeMatch = message.match(/"code"\s*:\s*(\d{3})/);
  if (codeMatch) return Number(codeMatch[1]);

  const statusMatch = message.match(/\b(4\d{2}|5\d{2})\b/);
  if (statusMatch) return Number(statusMatch[1]);

  return null;
}

/**
 * Maps a provider/generation error to a client-safe HTTP status and message.
 * Detailed error information stays in server logs; the client receives an
 * actionable but non-sensitive message so admins can self-diagnose.
 */
function classifyAiError(error: unknown): { status: number; message: string } {
  const rawMessage = error instanceof Error ? error.message : "Unknown server error";
  console.error("AI Generation Error", { message: rawMessage });

  if (error instanceof Error && /is not configured/i.test(error.message)) {
    return {
      status: 503,
      message:
        "The selected AI provider is not configured on the server. Add its API key or choose a different provider in Settings.",
    };
  }

  const providerStatus = extractProviderStatus(error);

  if (providerStatus === 429) {
    return {
      status: 429,
      message:
        "The AI provider is rate-limited or the quota for the selected model has been exhausted. Wait a moment and retry, or switch the AI model/provider in Settings.",
    };
  }

  if (providerStatus === 401 || providerStatus === 403) {
    return {
      status: 502,
      message:
        "The AI provider rejected the request due to an authentication or permission problem. Check the provider's API key in Settings.",
    };
  }

  if (providerStatus === 400 || providerStatus === 404) {
    return {
      status: 502,
      message:
        "The AI provider rejected the request. The selected model may be unavailable for your account. Try a different model in Settings.",
    };
  }

  if (typeof providerStatus === "number" && providerStatus >= 500) {
    return {
      status: 502,
      message: "The AI provider is currently unavailable. Please try again in a few moments.",
    };
  }

  return {
    status: 500,
    message: "Unable to generate AI content right now. Please try again later.",
  };
}

function getAllowedCorsOrigins(): string[] {
  const configuredOrigins = process.env.CORS_ALLOWED_ORIGINS || "";
  return configuredOrigins
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

/**
 * Browsers always send an Origin for cross-origin fetches. On Vercel, the SPA and API share one hostname,
 * but CORS must still allow that Origin. A missing CORS_ALLOWED_ORIGINS used to make cors() call
 * callback(new Error("CORS origin denied")) for every browser request, producing 500s before route handlers.
 */
function isBrowserOriginSameSiteAsRequest(origin: string | undefined, req: express.Request): boolean {
  if (!origin) return false;
  const host = req.get("x-forwarded-host") || req.get("host");
  if (!host) return false;
  try {
    return new URL(origin).hostname === host.split(":")[0];
  } catch {
    return false;
  }
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
  if (field.arrayValue && typeof field.arrayValue === "object") {
    const values = (field.arrayValue as { values?: Array<Record<string, unknown>> }).values || [];
    return values.map((nested) => parseFirestoreValue(nested));
  }
  if (field.mapValue && typeof field.mapValue === "object") {
    const mapFields = (field.mapValue as { fields?: Record<string, Record<string, unknown>> }).fields || {};
    return Object.fromEntries(Object.entries(mapFields).map(([key, nested]) => [key, parseFirestoreValue(nested)]));
  }
  return undefined;
}

function asObjectArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
}

/** Union of two string lists (case-insensitive dedup, primary order preserved), capped. */
function mergeStringList(primary: unknown, secondary: unknown, cap: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const source = [
    ...(Array.isArray(primary) ? primary : []),
    ...(Array.isArray(secondary) ? secondary : []),
  ];
  for (const item of source) {
    if (typeof item !== "string") continue;
    const key = item.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= cap) break;
  }
  return out;
}

/** Union of two object lists, de-duplicated by a derived key (primary wins), capped. */
function mergeObjectList(
  primary: unknown,
  secondary: unknown,
  keyOf: (item: Record<string, unknown>) => string,
  cap: number,
): Record<string, unknown>[] {
  const seen = new Set<string>();
  const out: Record<string, unknown>[] = [];
  for (const item of [...asObjectArray(primary), ...asObjectArray(secondary)]) {
    const key = keyOf(item);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(item);
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * Concatenate two object lists keeping every entry, but re-id any collision so the
 * merged list has unique `id`s (milestones/dependencies/checkpoints identify rows by id).
 */
function concatWithUniqueIds(primary: unknown, secondary: unknown): Record<string, unknown>[] {
  const usedIds = new Set<string>();
  const out: Record<string, unknown>[] = [];
  const add = (item: Record<string, unknown>) => {
    const next = { ...item };
    if (typeof next.id === "string") {
      if (usedIds.has(next.id)) next.id = randomUUID();
      usedIds.add(next.id as string);
    }
    out.push(next);
  };
  asObjectArray(primary).forEach(add);
  asObjectArray(secondary).forEach(add);
  return out;
}

/** Encode a plain JS value into a Firestore REST value object (inverse of parseFirestoreValue). */
function toFirestoreValue(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (typeof value === "string") return { stringValue: value };
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map((item) => toFirestoreValue(item)) } };
  }
  if (typeof value === "object") {
    const fields: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (nested === undefined) continue;
      fields[key] = toFirestoreValue(nested);
    }
    return { mapValue: { fields } };
  }
  return { nullValue: null };
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

async function fetchProjectsForPublicNarrative(): Promise<Record<string, unknown>[]> {
  const result = await firestoreCall("projects?pageSize=500");
  const documents = (result.documents as Array<{ name?: string; fields?: Record<string, Record<string, unknown>> }> | undefined) || [];
  return documents.map((doc) => parseFirestoreDocument(doc));
}

function truncateTextForPrompt(value: unknown, maxLength: number): string {
  const text = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
}

function stringArrayForPrompt(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim())
    .slice(0, maxItems);
}

function projectDateSortValue(project: Record<string, unknown>): number {
  return (toDate(project.updatedAt) || toDate(project.createdAt) || new Date(0)).getTime();
}

function formatProjectForPublicNarrative(project: Record<string, unknown>, index: number): string {
  const owner = project.owner && typeof project.owner === "object"
    ? (project.owner as { name?: unknown }).name
    : undefined;
  const tags = stringArrayForPrompt(project.tags, 5);
  const pieces = [
    `${index + 1}. ${truncateTextForPrompt(project.title, 90)} (${truncateTextForPrompt(project.code, 40) || "no code"})`,
    `status: ${truncateTextForPrompt(project.status, 40) || "unknown"}`,
    `department: ${truncateTextForPrompt(project.department, 60) || "unspecified"}`,
    `priority: ${truncateTextForPrompt(project.priority, 20) || "unspecified"}`,
    `progress: ${typeof project.progress === "number" ? `${project.progress}%` : "unknown"}`,
    `owner: ${truncateTextForPrompt(owner, 60) || "unassigned"}`,
  ];
  const description = truncateTextForPrompt(project.description, 220);
  if (description) pieces.push(`description: ${description}`);
  if (tags.length > 0) pieces.push(`tags: ${tags.join(", ")}`);
  const dueDate = truncateTextForPrompt(project.dueDate, 30);
  if (dueDate) pieces.push(`due date: ${dueDate}`);
  return `- ${pieces.join("; ")}`;
}

function buildPublicNarrativePrompt(
  basePrompt: string,
  settings: Partial<AppSettings>,
  projects: Record<string, unknown>[],
): string {
  const publicProjects = projects
    .filter((project) => project.isPublic !== false)
    .sort((left, right) => projectDateSortValue(right) - projectDateSortValue(left));
  const limitedProjects = publicProjects.slice(0, PUBLIC_NARRATIVE_MAX_PROJECTS);
  const statusCounts = publicProjects.reduce<Record<string, number>>((acc, project) => {
    const status = typeof project.status === "string" && project.status.trim() ? project.status.trim() : "Unknown";
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
  const departmentCounts = publicProjects.reduce<Record<string, number>>((acc, project) => {
    const department = typeof project.department === "string" && project.department.trim() ? project.department.trim() : "Unspecified";
    acc[department] = (acc[department] || 0) + 1;
    return acc;
  }, {});
  const statusSummary = Object.entries(statusCounts).map(([status, count]) => `${status}: ${count}`).join(", ") || "none";
  const departmentSummary = Object.entries(departmentCounts).slice(0, 8).map(([department, count]) => `${department}: ${count}`).join(", ") || "none";
  const projectLines = limitedProjects.map(formatProjectForPublicNarrative).join("\n");
  const context = [
    basePrompt.trim(),
    "",
    "Use the public project portfolio below as the source material. Write for the main public dashboard, avoid internal-only wording, do not invent project names or metrics, and synthesize themes across the work rather than listing every project.",
    "",
    `Organization: ${settings.portalName || "Project Archives"}`,
    `Product: ${settings.suiteName || "AI Librarian Suite"}`,
    `Public projects available: ${publicProjects.length} of ${projects.length} total records`,
    `Status mix: ${statusSummary}`,
    `Department mix: ${departmentSummary}`,
    "",
    publicProjects.length > 0
      ? `Project records (${limitedProjects.length} most recent public records):\n${projectLines}`
      : "Project records: No public project records are currently available. Keep the narrative general and avoid claiming active work that is not present.",
  ].join("\n");

  return truncateTextForPrompt(context, PUBLIC_NARRATIVE_MAX_CONTEXT_CHARS);
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

function validateSettings(input: unknown): AppSettings | null {
  if (!input || typeof input !== "object") return null;
  const source = input as Record<string, unknown>;

  const enabledProviders = Array.isArray(source.enabledProviders)
    ? source.enabledProviders
    : [source.activeProvider];
  const normalizedEnabledProviders = enabledProviders.filter(
    (provider): provider is string => typeof provider === "string" && ALLOWED_PROVIDERS.has(provider),
  );

  if (
    typeof source.aiEnabled !== "boolean" ||
    (source.aiAutoTagEnabled !== undefined && typeof source.aiAutoTagEnabled !== "boolean") ||
    (source.aiSummarizeEnabled !== undefined && typeof source.aiSummarizeEnabled !== "boolean") ||
    typeof source.aiNextBestActionEnabled !== "boolean" ||
    typeof source.aiRiskNarrativeEnabled !== "boolean" ||
    typeof source.aiDuplicateDetectionEnabled !== "boolean" ||
    typeof source.aiPmApproachEnabled !== "boolean" ||
    typeof source.aiRequireHumanApproval !== "boolean" ||
    typeof source.activeProvider !== "string" ||
    !ALLOWED_PROVIDERS.has(source.activeProvider) ||
    normalizedEnabledProviders.length === 0 ||
    normalizedEnabledProviders.some((provider) => !ALLOWED_PROVIDERS.has(provider)) ||
    !normalizedEnabledProviders.includes(source.activeProvider) ||
    (source.privacyMode !== "public-read" && source.privacyMode !== "private-read") ||
    (source.publicLayout !== undefined && source.publicLayout !== "standard" && source.publicLayout !== "embed") ||
    (source.embedShowLogo !== undefined && typeof source.embedShowLogo !== "boolean") ||
    typeof source.suiteName !== "string" ||
    source.suiteName.trim().length === 0 ||
    source.suiteName.length > 80 ||
    typeof source.portalName !== "string" ||
    source.portalName.trim().length === 0 ||
    source.portalName.length > 80 ||
    typeof source.logoDataUrl !== "string" ||
    source.logoDataUrl.length > 150_000 ||
    (source.heroImageDataUrl !== undefined && (typeof source.heroImageDataUrl !== "string" || source.heroImageDataUrl.length > HERO_IMAGE_MAX_LENGTH)) ||
    typeof source.primaryColor !== "string" ||
    !source.primaryColor.match(/^#[0-9A-Fa-f]{6}$/) ||
    typeof source.brandDarkColor !== "string" ||
    !source.brandDarkColor.match(/^#[0-9A-Fa-f]{6}$/) ||
    (source.customFooter !== undefined && (typeof source.customFooter !== "string" || source.customFooter.length > 500)) ||
    (source.showFooter !== undefined && typeof source.showFooter !== "boolean") ||
    (source.helpContactEmail !== undefined && (typeof source.helpContactEmail !== "string" || source.helpContactEmail.length > 254)) ||
    (source.googleDriveFolderBaseUrl !== undefined && (typeof source.googleDriveFolderBaseUrl !== "string" || source.googleDriveFolderBaseUrl.length > 500)) ||
    (source.googleCalendarId !== undefined && (typeof source.googleCalendarId !== "string" || source.googleCalendarId.length > 254)) ||
    (source.heroNarrativeDraft !== undefined && (typeof source.heroNarrativeDraft !== "string" || source.heroNarrativeDraft.length > 6000)) ||
    (source.heroNarrativePublished !== undefined && (typeof source.heroNarrativePublished !== "string" || source.heroNarrativePublished.length > 6000)) ||
    (source.heroQuickLinks !== undefined && (!Array.isArray(source.heroQuickLinks) || source.heroQuickLinks.length > 8))
  ) {
    return null;
  }


  const heroQuickLinks = Array.isArray(source.heroQuickLinks)
    ? source.heroQuickLinks.filter((item): item is { id: string; label: string; url: string } => {
      if (!item || typeof item !== "object") return false;
      const link = item as Record<string, unknown>;
      return typeof link.id === "string" && link.id.length <= 60
        && typeof link.label === "string" && link.label.trim().length > 0 && link.label.length <= 40
        && typeof link.url === "string" && link.url.trim().length > 0 && link.url.length <= 500;
    })
    : [];

  const aiEnabled = source.aiEnabled;
  const aiAutoTagEnabled =
    typeof source.aiAutoTagEnabled === "boolean" ? source.aiAutoTagEnabled : aiEnabled;
  const aiSummarizeEnabled =
    typeof source.aiSummarizeEnabled === "boolean" ? source.aiSummarizeEnabled : aiEnabled;

  return {
    aiEnabled,
    activeProvider: source.activeProvider,
    enabledProviders: Array.from(new Set(normalizedEnabledProviders)),
    aiAutoTagEnabled,
    aiSummarizeEnabled,
    aiNextBestActionEnabled: source.aiNextBestActionEnabled,
    aiRiskNarrativeEnabled: source.aiRiskNarrativeEnabled,
    aiDuplicateDetectionEnabled: source.aiDuplicateDetectionEnabled,
    aiPmApproachEnabled: source.aiPmApproachEnabled,
    aiRequireHumanApproval: source.aiRequireHumanApproval,
    privacyMode: source.privacyMode,
    publicLayout: source.publicLayout === "embed" ? "embed" : "standard",
    embedShowLogo: typeof source.embedShowLogo === "boolean" ? source.embedShowLogo : true,
    suiteName: source.suiteName.trim(),
    portalName: source.portalName.trim(),
    logoDataUrl: source.logoDataUrl,
    heroImageDataUrl: typeof source.heroImageDataUrl === "string" ? source.heroImageDataUrl : undefined,
    primaryColor: source.primaryColor,
    brandDarkColor: source.brandDarkColor,
    customFooter: typeof source.customFooter === "string" ? source.customFooter.trim() : undefined,
    showFooter: typeof source.showFooter === "boolean" ? source.showFooter : true,
    helpContactEmail: typeof source.helpContactEmail === "string" ? source.helpContactEmail.trim() : undefined,
    googleDriveFolderBaseUrl: typeof source.googleDriveFolderBaseUrl === "string" ? source.googleDriveFolderBaseUrl.trim() : undefined,
    googleCalendarId: typeof source.googleCalendarId === "string" ? source.googleCalendarId.trim() : undefined,
    heroQuickLinks,
    heroNarrativeDraft: typeof source.heroNarrativeDraft === "string" ? source.heroNarrativeDraft.trim() : undefined,
    heroNarrativePublished: typeof source.heroNarrativePublished === "string" ? source.heroNarrativePublished.trim() : undefined,
  };
}

function toFirestoreFields(settings: AppSettings): Record<string, { stringValue?: string; booleanValue?: boolean; arrayValue?: { values: Array<{ stringValue: string }> } }> {
  return {
    aiEnabled: { booleanValue: settings.aiEnabled },
    activeProvider: { stringValue: settings.activeProvider },
    enabledProviders: { arrayValue: { values: settings.enabledProviders.map((provider) => ({ stringValue: provider })) } },
    aiAutoTagEnabled: { booleanValue: settings.aiAutoTagEnabled },
    aiSummarizeEnabled: { booleanValue: settings.aiSummarizeEnabled },
    aiNextBestActionEnabled: { booleanValue: settings.aiNextBestActionEnabled },
    aiRiskNarrativeEnabled: { booleanValue: settings.aiRiskNarrativeEnabled },
    aiDuplicateDetectionEnabled: { booleanValue: settings.aiDuplicateDetectionEnabled },
    aiPmApproachEnabled: { booleanValue: settings.aiPmApproachEnabled },
    aiRequireHumanApproval: { booleanValue: settings.aiRequireHumanApproval },
    privacyMode: { stringValue: settings.privacyMode },
    ...(settings.publicLayout !== undefined && { publicLayout: { stringValue: settings.publicLayout } }),
    ...(settings.embedShowLogo !== undefined && { embedShowLogo: { booleanValue: settings.embedShowLogo } }),
    suiteName: { stringValue: settings.suiteName },
    portalName: { stringValue: settings.portalName },
    logoDataUrl: { stringValue: settings.logoDataUrl },
    ...(settings.heroImageDataUrl !== undefined && { heroImageDataUrl: { stringValue: settings.heroImageDataUrl } }),
    primaryColor: { stringValue: settings.primaryColor },
    brandDarkColor: { stringValue: settings.brandDarkColor },
    ...(settings.customFooter !== undefined && { customFooter: { stringValue: settings.customFooter } }),
    ...(settings.showFooter !== undefined && { showFooter: { booleanValue: settings.showFooter } }),
    ...(settings.helpContactEmail !== undefined && { helpContactEmail: { stringValue: settings.helpContactEmail } }),
    ...(settings.googleDriveFolderBaseUrl !== undefined && { googleDriveFolderBaseUrl: { stringValue: settings.googleDriveFolderBaseUrl } }),
    ...(settings.googleCalendarId !== undefined && { googleCalendarId: { stringValue: settings.googleCalendarId } }),
    ...(settings.heroQuickLinks !== undefined && { heroQuickLinksJson: { stringValue: JSON.stringify(settings.heroQuickLinks) } }),
    ...(settings.heroNarrativeDraft !== undefined && { heroNarrativeDraft: { stringValue: settings.heroNarrativeDraft } }),
    ...(settings.heroNarrativePublished !== undefined && { heroNarrativePublished: { stringValue: settings.heroNarrativePublished } }),
  };
}

function fromFirestoreFields(
  fields: Record<string, { stringValue?: string; booleanValue?: boolean; arrayValue?: { values?: Array<{ stringValue?: string }> } }> | undefined,
): Partial<AppSettings> {
  if (!fields) return {};
  return {
    aiEnabled: fields.aiEnabled?.booleanValue,
    activeProvider: fields.activeProvider?.stringValue,
    enabledProviders: fields.enabledProviders?.arrayValue?.values
      ?.map((value) => value?.stringValue)
      .filter((value): value is string => typeof value === "string" && ALLOWED_PROVIDERS.has(value)),
    aiAutoTagEnabled: fields.aiAutoTagEnabled?.booleanValue,
    aiSummarizeEnabled: fields.aiSummarizeEnabled?.booleanValue,
    aiNextBestActionEnabled: fields.aiNextBestActionEnabled?.booleanValue,
    aiRiskNarrativeEnabled: fields.aiRiskNarrativeEnabled?.booleanValue,
    aiDuplicateDetectionEnabled: fields.aiDuplicateDetectionEnabled?.booleanValue,
    aiPmApproachEnabled: fields.aiPmApproachEnabled?.booleanValue,
    aiRequireHumanApproval: fields.aiRequireHumanApproval?.booleanValue,
    privacyMode: fields.privacyMode?.stringValue as AppSettings["privacyMode"] | undefined,
    publicLayout: fields.publicLayout?.stringValue as AppSettings["publicLayout"] | undefined,
    embedShowLogo: fields.embedShowLogo?.booleanValue,
    suiteName: fields.suiteName?.stringValue,
    portalName: fields.portalName?.stringValue,
    logoDataUrl: fields.logoDataUrl?.stringValue,
    heroImageDataUrl: fields.heroImageDataUrl?.stringValue,
    primaryColor: fields.primaryColor?.stringValue,
    brandDarkColor: fields.brandDarkColor?.stringValue,
    customFooter: fields.customFooter?.stringValue,
    showFooter: fields.showFooter?.booleanValue,
    helpContactEmail: fields.helpContactEmail?.stringValue,
    googleDriveFolderBaseUrl: fields.googleDriveFolderBaseUrl?.stringValue,
    googleCalendarId: fields.googleCalendarId?.stringValue,
    heroQuickLinks: (() => {
      const raw = fields.heroQuickLinksJson?.stringValue;
      if (!raw) return undefined;
      try { return JSON.parse(raw) as Array<{ id: string; label: string; url: string }>; } catch { return undefined; }
    })(),
    heroNarrativeDraft: fields.heroNarrativeDraft?.stringValue,
    heroNarrativePublished: fields.heroNarrativePublished?.stringValue,
  };
}

function getFirebaseProjectId(): string {
  const value = process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || process.env.VITE_FIREBASE_PROJECT_ID;
  if (!value) throw new Error("Firebase project id is not configured");
  return value;
}

function getFirestoreDatabasePathSegment(): string {
  const configuredDatabaseId = (process.env.FIREBASE_DATABASE_ID || process.env.VITE_FIREBASE_DATABASE_ID || "").trim();
  if (!configuredDatabaseId || configuredDatabaseId === "(default)" || configuredDatabaseId === "default") {
    return "(default)";
  }
  return configuredDatabaseId;
}


function decodeTokenAudience(idToken: string): string | null {
  const parts = idToken.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { aud?: unknown };
    return typeof payload.aud === "string" && payload.aud.trim().length > 0 ? payload.aud : null;
  } catch {
    return null;
  }
}

function ensureFirebaseProjectAlignment(idToken: string): { ok: true } | { ok: false; error: string } {
  const tokenAudience = decodeTokenAudience(idToken);
  if (!tokenAudience) {
    return { ok: false, error: "Unable to determine Firebase project from auth token. Please sign out and sign in again." };
  }

  const expectedProjectId = getFirebaseProjectId();
  if (tokenAudience !== expectedProjectId) {
    return {
      ok: false,
      error:
        `Firebase project mismatch detected (token project: ${tokenAudience}, server project: ${expectedProjectId}). ` +
        "This can make users appear new and settings appear missing. Update VITE_FIREBASE_PROJECT_ID / FIREBASE_PROJECT_ID / FIREBASE_SERVICE_ACCOUNT_JSON to the same project.",
    };
  }

  return { ok: true };
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

async function firestoreCall(path: string, options: { method?: string; body?: unknown } = {}): Promise<Record<string, unknown>> {
  const token = await getGoogleAccessToken("https://www.googleapis.com/auth/datastore");
  const projectId = getFirebaseProjectId();
  const databasePath = getFirestoreDatabasePathSegment();
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databasePath}/documents/${path}`, {
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

/** Run a Firestore structured query via the REST API and return the matched documents. */
async function firestoreRunQuery(structuredQuery: Record<string, unknown>): Promise<Array<{ name?: string; fields?: Record<string, Record<string, unknown>> }>> {
  const token = await getGoogleAccessToken("https://www.googleapis.com/auth/datastore");
  const projectId = getFirebaseProjectId();
  const databasePath = getFirestoreDatabasePathSegment();
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databasePath}/documents:runQuery`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ structuredQuery }),
  });
  const data = await response.json().catch(() => ([] as unknown));
  if (!response.ok) {
    throw new Error((data as { error?: { message?: string } })?.error?.message || "Firestore query failed");
  }
  const rows = Array.isArray(data) ? (data as Array<{ document?: { name?: string; fields?: Record<string, Record<string, unknown>> } }>) : [];
  return rows.map((row) => row.document).filter((doc): doc is { name?: string; fields?: Record<string, Record<string, unknown>> } => Boolean(doc));
}

async function fetchFirestoreSettings(): Promise<Partial<AppSettings>> {
  try {
    const result = await firestoreCall("settings/global");
    return fromFirestoreFields(result.fields as Record<string, { stringValue?: string; booleanValue?: boolean }> | undefined);
  } catch {
    return {};
  }
}

function firestoreResponseMeansDocumentMissing(status: number, data: { error?: { status?: string; code?: number } }): boolean {
  if (status === 404) return true;
  if (data.error?.status === "NOT_FOUND") return true;
  if (data.error?.code === 5) return true; // gRPC NOT_FOUND
  if (data.error?.code === 404) return true; // some REST error shapes
  return false;
}

/** Commit settings: PATCH existing doc, or create `settings/global` if missing (first deploy / empty project). */
async function saveFirestoreSettings(settings: AppSettings): Promise<void> {
  const token = await getGoogleAccessToken("https://www.googleapis.com/auth/datastore");
  const projectId = getFirebaseProjectId();
  const databasePath = getFirestoreDatabasePathSegment();
  const fields = toFirestoreFields(settings);
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databasePath}/documents`;
  const globalPath = "settings/global";
  const updateMaskParams = new URLSearchParams();
  for (const fieldPath of Object.keys(fields)) {
    updateMaskParams.append("updateMask.fieldPaths", fieldPath);
  }
  let response = await fetch(`${base}/${globalPath}?${updateMaskParams.toString()}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields }),
  });
  let data = (await response.json().catch(() => ({}))) as { error?: { message?: string; status?: string; code?: number } };

  if (!response.ok && firestoreResponseMeansDocumentMissing(response.status, data)) {
    const createUrl = `${base}/settings?documentId=global`;
    response = await fetch(createUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fields }),
    });
    data = (await response.json().catch(() => ({}))) as { error?: { message?: string; status?: string; code?: number } };
  }

  if (!response.ok) {
    const msg = data.error?.message || "Firestore write failed for global settings";
    throw new Error(
      `Saving settings to Firestore failed: ${msg}. ` +
        "Confirm Vercel has FIREBASE_SERVICE_ACCOUNT_JSON and IAM permission on Cloud Firestore data.",
    );
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
  const configured = (process.env.OWNER_EMAILS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return configured;
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
  // If no bootstrap emails are configured:
  // - Local/dev: allow self-service claim (convenience for first-run).
  // - Production/Vercel: require explicit OWNER_EMAILS configuration.
  if (ownerEmails.length === 0) return !isProduction && !isVercel;
  return false;
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

type UserPreferences = {
  siteTourCompleted: boolean;
  siteTourDismissed: boolean;
};

/**
 * Per-user preferences persisted server-side in `userPreferences/{uid}` so that
 * choices like the onboarding tour's "Do not show this again" survive across
 * devices and fresh logins (localStorage alone is per-browser and forgets).
 */
async function getUserPreferences(uid: string): Promise<UserPreferences> {
  try {
    const result = await firestoreCall(`userPreferences/${uid}`);
    const parsed = parseFirestoreDocument(result as { name?: string; fields?: Record<string, Record<string, unknown>> });
    return {
      siteTourCompleted: parsed.siteTourCompleted === true,
      siteTourDismissed: parsed.siteTourDismissed === true,
    };
  } catch {
    return { siteTourCompleted: false, siteTourDismissed: false };
  }
}

async function saveUserPreferences(uid: string, prefs: UserPreferences): Promise<void> {
  const fields = {
    siteTourCompleted: { booleanValue: prefs.siteTourCompleted },
    siteTourDismissed: { booleanValue: prefs.siteTourDismissed },
    updatedAt: { timestampValue: new Date().toISOString() },
  };
  await firestoreCall(`userPreferences/${uid}`, { method: "PATCH", body: { fields } });
}

function hashPassword(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeCompareHash(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

async function getElevatedAccessConfig(): Promise<{ passwordHash: string; needsChange: boolean }> {
  const initialPassword = process.env[ELEVATED_ACCESS_INITIAL_PASSWORD_ENV];
  const hasInitialPassword = typeof initialPassword === "string" && initialPassword.trim().length > 0;
  if ((isProduction || isVercel) && !hasInitialPassword) {
    throw new Error(
      `${ELEVATED_ACCESS_INITIAL_PASSWORD_ENV} is required in production before elevated access can be used`,
    );
  }
  try {
    const result = await firestoreCall("settings/global");
    const parsed = parseFirestoreDocument(result as { name?: string; fields?: Record<string, Record<string, unknown>> });
    const passwordHash = typeof parsed.elevatedPasswordHash === "string" && parsed.elevatedPasswordHash.length > 0
      ? parsed.elevatedPasswordHash
      : hasInitialPassword
        ? hashPassword(initialPassword!.trim())
        : "";
    if (!passwordHash) {
      throw new Error(
        `${ELEVATED_ACCESS_INITIAL_PASSWORD_ENV} is not configured; set it before first elevated login`,
      );
    }
    const needsChange = typeof parsed.elevatedPasswordNeedsChange === "boolean"
      ? parsed.elevatedPasswordNeedsChange
      : true;
    return { passwordHash, needsChange };
  } catch {
    if (!hasInitialPassword) {
      throw new Error(
        `${ELEVATED_ACCESS_INITIAL_PASSWORD_ENV} is not configured; set it before first elevated login`,
      );
    }
    return { passwordHash: hashPassword(initialPassword!.trim()), needsChange: true };
  }
}

async function saveElevatedAccessConfig(config: { passwordHash: string; needsChange: boolean }): Promise<void> {
  const token = await getGoogleAccessToken("https://www.googleapis.com/auth/datastore");
  const projectId = getFirebaseProjectId();
  const databasePath = getFirestoreDatabasePathSegment();
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databasePath}/documents`;
  const fields = {
    elevatedPasswordHash: { stringValue: config.passwordHash },
    elevatedPasswordNeedsChange: { booleanValue: config.needsChange },
  };
  const updateMaskParams = new URLSearchParams();
  for (const fieldPath of Object.keys(fields)) {
    updateMaskParams.append("updateMask.fieldPaths", fieldPath);
  }
  let response = await fetch(`${base}/settings/global?${updateMaskParams.toString()}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields }),
  });
  let data = (await response.json().catch(() => ({}))) as { error?: { message?: string; status?: string; code?: number } };

  if (!response.ok && firestoreResponseMeansDocumentMissing(response.status, data)) {
    response = await fetch(`${base}/settings?documentId=global`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fields }),
    });
    data = (await response.json().catch(() => ({}))) as { error?: { message?: string; status?: string; code?: number } };
  }

  if (!response.ok) {
    throw new Error(data.error?.message || "Unable to save elevated access configuration");
  }
}

async function resolveEffectiveRole(verifiedUser: VerifiedUser): Promise<AppRole> {
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
  // Dynamic options: first argument is the incoming request (see cors `middlewareWrapper`).
  cors((req, callback) => {
    const origin = req.header("Origin") || undefined;
    if (!origin) {
      callback(null, { origin: true });
      return;
    }
    if (allowedOrigins.includes(origin) || (!isProduction && devOrigins.includes(origin))) {
      callback(null, { origin: true });
      return;
    }
    if (isBrowserOriginSameSiteAsRequest(origin, req)) {
      callback(null, { origin: true });
      return;
    }
    callback(new Error("CORS origin denied"));
  }),
);
// The settings payload can carry a base64 logo (150k-char cap) plus a base64 hero image (600k-char cap), so the
// global parser limit must exceed their combined size; per-route limits (e.g. ADMIN_SETTINGS_MAX_BODY_BYTES) still
// apply the real caps after parsing. 350kb rejected legal hero uploads with a misleading 413.
app.use(express.json({ limit: "1mb" }));
app.use((
  err: unknown,
  _req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) => {
  const e = err as { statusCode?: number; type?: string; message?: string };
  if (e?.type === "entity.too.large" || (e?.statusCode === 413 && res.headersSent === false)) {
    res.status(413).json({ error: "Request body too large. Remove or use smaller logo/hero images and try again." });
    return;
  }
  if (res.headersSent) {
    next(err);
    return;
  }
  next(err);
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

// ---------------------------------------------------------------------------
// Public community endpoints (no auth): likes + "Suggest a project" intake.
// Anonymous visitors cannot write to Firestore directly (rules only allow
// public reads), so these routes perform the writes with server credentials.
// ---------------------------------------------------------------------------

/** Keep in sync with COMMUNITY_SUGGESTION_CATEGORIES in src/lib/communityIntake.ts. */
const PUBLIC_SUGGESTION_CATEGORIES = new Set([
  "AI Learning Hub Suggestions",
  "AI Upload Suggestions",
  "New Guides",
  "Coding Help",
  "Research & Data Tools",
  "Workflow Automation",
  "Trainings & Workshops",
  "Other",
]);

const PUBLIC_LIKE_RATE_LIMIT = { maxRequests: 30, windowMs: 60_000 };
const PUBLIC_SUGGESTION_RATE_LIMIT = { maxRequests: 5, windowMs: 10 * 60_000 };
const PUBLIC_SUGGESTION_MAX_BODY_BYTES = 24 * 1024;
const PUBLIC_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const FIRESTORE_DOC_ID_REGEX = /^[A-Za-z0-9_-]{1,128}$/;

function publicIntakeEmailWebhookUrl(): string {
  return process.env.INTAKE_EMAIL_WEBHOOK_URL || process.env.OPS_DIGEST_EMAIL_WEBHOOK_URL || "";
}

function cleanPublicText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function cleanPublicMultilineText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\r\n/g, "\n").trim().slice(0, maxLength);
}

function initialsFromName(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  const initials = parts.slice(0, 2).map((part) => part[0]!.toUpperCase()).join("");
  return initials || "CS";
}

/** Atomically adjusts a project's likeCount via a Firestore commit field transform. */
async function applyLikeCountTransform(projectId: string, delta: 1 | -1): Promise<void> {
  const token = await getGoogleAccessToken("https://www.googleapis.com/auth/datastore");
  const firebaseProjectId = getFirebaseProjectId();
  const databasePath = getFirestoreDatabasePathSegment();
  const documentName = `projects/${firebaseProjectId}/databases/${databasePath}/documents/projects/${projectId}`;
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${firebaseProjectId}/databases/${databasePath}/documents:commit`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        writes: [{
          transform: {
            document: documentName,
            fieldTransforms: [{ fieldPath: "likeCount", increment: { integerValue: String(delta) } }],
          },
        }],
      }),
    },
  );
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(data.error?.message || "Failed to update like count");
  }
}

app.post("/api/public/projects/:projectId/like", async (req, res) => {
  try {
    if (!enforceRequestSizeLimit(req, 1024)) {
      return res.status(413).json({ error: "Request body too large." });
    }
    const rate = await checkRateLimitDistributed(getClientIp(req), {
      ...PUBLIC_LIKE_RATE_LIMIT,
      namespace: "public-like",
    });
    if (!rate.allowed) {
      res.setHeader("Retry-After", String(rate.retryAfterSeconds));
      return res.status(429).json({ error: "Too many reactions right now. Please try again in a minute." });
    }

    const projectId = req.params.projectId;
    if (!FIRESTORE_DOC_ID_REGEX.test(projectId)) {
      return res.status(400).json({ error: "Invalid project id" });
    }
    const action = (req.body as { action?: unknown } | undefined)?.action;
    if (action !== "like" && action !== "unlike") {
      return res.status(400).json({ error: "action must be 'like' or 'unlike'" });
    }

    const doc = await firestoreCall(`projects/${projectId}`).catch(() => null);
    if (!doc || !doc.fields) {
      return res.status(404).json({ error: "Project not found" });
    }
    const parsed = parseFirestoreDocument(doc as { name?: string; fields?: Record<string, Record<string, unknown>> });
    if (parsed.isPublic === false) {
      return res.status(404).json({ error: "Project not found" });
    }

    const currentCount = typeof parsed.likeCount === "number" && Number.isFinite(parsed.likeCount)
      ? Math.max(0, Math.floor(parsed.likeCount))
      : 0;
    if (action === "unlike" && currentCount === 0) {
      return res.json({ likeCount: 0 });
    }

    await applyLikeCountTransform(projectId, action === "like" ? 1 : -1);
    return res.json({ likeCount: Math.max(0, currentCount + (action === "like" ? 1 : -1)) });
  } catch (error) {
    console.error("Public like failed:", error instanceof Error ? error.message : error);
    return res.status(500).json({ error: "Unable to record your like right now. Please try again later." });
  }
});

app.post("/api/public/suggestions", async (req, res) => {
  try {
    if (!enforceRequestSizeLimit(req, PUBLIC_SUGGESTION_MAX_BODY_BYTES)) {
      return res.status(413).json({ error: "Request body too large." });
    }
    const rate = await checkRateLimitDistributed(getClientIp(req), {
      ...PUBLIC_SUGGESTION_RATE_LIMIT,
      namespace: "public-suggest",
    });
    if (!rate.allowed) {
      res.setHeader("Retry-After", String(rate.retryAfterSeconds));
      return res.status(429).json({ error: "Too many submissions from this connection. Please try again a little later." });
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const name = cleanPublicText(body.name, 100);
    const email = cleanPublicText(body.email, 254);
    const projectName = cleanPublicText(body.projectName, 100);
    const category = cleanPublicText(body.category, 80);
    const description = cleanPublicMultilineText(body.description, 4000);
    const goal = cleanPublicMultilineText(body.goal, 1000);
    const audience = cleanPublicText(body.audience, 300);

    if (!name) return res.status(400).json({ error: "Please tell us your name." });
    if (!PUBLIC_EMAIL_REGEX.test(email)) return res.status(400).json({ error: "Please provide a valid email address." });
    if (!projectName) return res.status(400).json({ error: "Please give your idea a short project name." });
    if (!PUBLIC_SUGGESTION_CATEGORIES.has(category)) return res.status(400).json({ error: "Please pick one of the listed categories." });
    if (description.length < 10) return res.status(400).json({ error: "Please describe your idea in a sentence or two." });
    if (!goal) return res.status(400).json({ error: "Please tell us what this idea should accomplish." });

    const now = new Date();
    const nowIso = now.toISOString();
    // SLS- prefix (vs. the AI- prefix used for team-created projects) is a quick visual
    // identifier for community-suggested cards; the random suffix avoids a uniqueness query.
    const code = `SLS-${nowIso.slice(0, 10).replace(/-/g, "")}-${nowIso.slice(11, 19).replace(/:/g, "")}-${randomUUID().slice(0, 4).toUpperCase()}`;

    const intakeFields: Record<string, Record<string, unknown>> = {
      submitterName: { stringValue: name },
      submitterEmail: { stringValue: email },
      category: { stringValue: category },
      goal: { stringValue: goal },
      submittedAt: { stringValue: nowIso },
    };
    if (audience) intakeFields.audience = { stringValue: audience };

    const created = await firestoreCall("projects", {
      method: "POST",
      body: {
        fields: {
          title: { stringValue: projectName },
          description: { stringValue: description },
          status: { stringValue: "Intake / Proposed" },
          priority: { stringValue: "Medium" },
          tags: { arrayValue: { values: [{ stringValue: "Community Suggestion" }] } },
          code: { stringValue: code },
          owner: {
            mapValue: {
              fields: {
                name: { stringValue: name },
                initials: { stringValue: initialsFromName(name) },
              },
            },
          },
          // Community suggestions start private; the team reviews them and flips them public manually.
          isPublic: { booleanValue: false },
          progress: { integerValue: "0" },
          department: { stringValue: category },
          preservationScore: { integerValue: "0" },
          riskFactor: { stringValue: "Low" },
          likeCount: { integerValue: "0" },
          source: { stringValue: "community" },
          intake: { mapValue: { fields: intakeFields } },
          createdAt: { timestampValue: nowIso },
          updatedAt: { timestampValue: nowIso },
        },
      },
    });

    const createdId = typeof created.name === "string" ? created.name.split("/").pop() || "" : "";
    auditLog("public_suggestion_created", { code, category, ip: getClientIp(req) });
    return res.status(201).json({ id: createdId, code });
  } catch (error) {
    console.error("Public suggestion failed:", error instanceof Error ? error.message : error);
    return res.status(500).json({ error: "Unable to submit your suggestion right now. Please try again later." });
  }
});

app.post("/api/public/suggestions/:suggestionId/email-copy", async (req, res) => {
  try {
    if (!enforceRequestSizeLimit(req, 2048)) {
      return res.status(413).json({ error: "Request body too large." });
    }
    const rate = await checkRateLimitDistributed(getClientIp(req), {
      ...PUBLIC_SUGGESTION_RATE_LIMIT,
      namespace: "public-suggest-email",
    });
    if (!rate.allowed) {
      res.setHeader("Retry-After", String(rate.retryAfterSeconds));
      return res.status(429).json({ error: "Too many email requests. Please try again a little later." });
    }

    const suggestionId = req.params.suggestionId;
    if (!FIRESTORE_DOC_ID_REGEX.test(suggestionId)) {
      return res.status(400).json({ error: "Invalid suggestion id" });
    }
    const email = cleanPublicText((req.body as { email?: unknown } | undefined)?.email, 254);
    if (!PUBLIC_EMAIL_REGEX.test(email)) {
      return res.status(400).json({ error: "Please provide a valid email address." });
    }

    const webhookUrl = publicIntakeEmailWebhookUrl();
    if (!webhookUrl) {
      return res.status(503).json({
        error: "Email delivery is not configured on the server.",
        notConfigured: true,
      });
    }

    const doc = await firestoreCall(`projects/${suggestionId}`).catch(() => null);
    if (!doc || !doc.fields) {
      return res.status(404).json({ error: "Suggestion not found" });
    }
    const parsed = parseFirestoreDocument(doc as { name?: string; fields?: Record<string, Record<string, unknown>> });
    // Only community-suggested projects can be emailed, and only with the content we stored —
    // this endpoint must not become a relay for arbitrary user-authored email.
    if (parsed.source !== "community") {
      return res.status(404).json({ error: "Suggestion not found" });
    }

    const intake = (parsed.intake && typeof parsed.intake === "object" ? parsed.intake : {}) as Record<string, unknown>;
    const lines = [
      "Thank you for suggesting a project to the Stanford Law School team!",
      "Your idea has been added to our project board for consideration. Submitting an idea does not guarantee it will be built, but every suggestion is reviewed for future work.",
      "",
      `Reference code: ${String(parsed.code || suggestionId)}`,
      `Project name: ${String(parsed.title || "")}`,
      `Category: ${String(intake.category || parsed.department || "")}`,
      `Submitted by: ${String(intake.submitterName || "")} (${String(intake.submitterEmail || "")})`,
      `Submitted at: ${String(intake.submittedAt || "")}`,
      "",
      "Description:",
      String(parsed.description || ""),
      "",
      "Goal:",
      String(intake.goal || ""),
    ];
    if (intake.audience) {
      lines.push("", "Who it would help:", String(intake.audience));
    }

    const emailResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: email,
        subject: `Copy of your project suggestion (${String(parsed.code || suggestionId)})`,
        body: lines.join("\n"),
      }),
    });
    if (!emailResponse.ok) {
      return res.status(502).json({ error: "The email service could not deliver the message. Please try again later." });
    }
    auditLog("public_suggestion_email_copy_sent", { suggestionId, ip: getClientIp(req) });
    return res.json({ sent: true });
  } catch (error) {
    console.error("Suggestion email copy failed:", error instanceof Error ? error.message : error);
    return res.status(500).json({ error: "Unable to send the email copy right now. Please try again later." });
  }
});

/**
 * Merge one project card ("secondary") into another ("primary") and delete the secondary.
 * Done server-side because it must touch things the browser can't under Firestore rules:
 * reassign the secondary's comments (their `projectId` is immutable to clients), sum the
 * server-managed `likeCount`, migrate the planning doc, and delete a project (a rules
 * admin-only action). Authorized here by canEditContent so any editor can merge.
 *
 * Merge policy: the primary's single-value fields win (title, description, status, ...);
 * list fields (tags, collaborators, artifactLinks, milestones, dependencies, checkpoints)
 * are combined and de-duplicated; likes are summed; comments and planning notes migrate.
 *
 * Not transactional across the individual REST writes: additive migrations run before the
 * secondary is deleted, so a mid-way failure leaves the secondary intact rather than losing
 * data. Retrying a run that failed after the primary was updated could double-count likes.
 */
app.post("/api/projects/merge", async (req, res) => {
  try {
    if (!enforceRequestSizeLimit(req, 4096)) {
      return res.status(413).json({ error: "Request body too large." });
    }
    const token = getBearerToken(req.headers.authorization);
    if (!token) return res.status(401).json({ error: "Authentication required" });
    const verifiedUser = await verifyFirebaseUser(token);
    if (!verifiedUser) return res.status(401).json({ error: "Invalid or expired auth token" });
    const callerRole = normalizeRoleFromClaims(verifiedUser.claims);
    const callerPermissions = sanitizePermissionSet(verifiedUser.claims.permissions, callerRole);
    if (!callerPermissions.canEditContent) {
      return res.status(403).json({ error: "Edit-content permission is required to merge projects." });
    }

    const primaryId = typeof req.body?.primaryId === "string" ? req.body.primaryId : "";
    const secondaryId = typeof req.body?.secondaryId === "string" ? req.body.secondaryId : "";
    if (!FIRESTORE_DOC_ID_REGEX.test(primaryId) || !FIRESTORE_DOC_ID_REGEX.test(secondaryId)) {
      return res.status(400).json({ error: "Valid primaryId and secondaryId are required." });
    }
    if (primaryId === secondaryId) {
      return res.status(400).json({ error: "Cannot merge a project into itself." });
    }

    const [primaryDoc, secondaryDoc] = await Promise.all([
      firestoreCall(`projects/${primaryId}`).catch(() => null),
      firestoreCall(`projects/${secondaryId}`).catch(() => null),
    ]);
    if (!primaryDoc?.fields) return res.status(404).json({ error: "The project to keep was not found." });
    if (!secondaryDoc?.fields) return res.status(404).json({ error: "The project to merge in was not found." });

    const primary = parseFirestoreDocument(primaryDoc as { name?: string; fields?: Record<string, Record<string, unknown>> });
    const secondary = parseFirestoreDocument(secondaryDoc as { name?: string; fields?: Record<string, Record<string, unknown>> });
    const primaryCode = typeof primary.code === "string" ? primary.code : "";
    const secondaryCode = typeof secondary.code === "string" ? secondary.code : "";

    // --- Build the merged embedded fields (primary scalars are left untouched) ---
    const mergedFields: Record<string, Record<string, unknown>> = {};
    const maskPaths: string[] = [];
    const setField = (name: string, value: unknown) => {
      mergedFields[name] = toFirestoreValue(value);
      maskPaths.push(name);
    };

    setField("tags", mergeStringList(primary.tags, secondary.tags, 20));
    setField("collaborators", mergeObjectList(primary.collaborators, secondary.collaborators, (item) => String(item.uid || item.name || "").toLowerCase(), 50));
    setField("artifactLinks", mergeObjectList(primary.artifactLinks, secondary.artifactLinks, (item) => String(item.url || item.id || "").toLowerCase(), 20));
    setField("milestones", concatWithUniqueIds(primary.milestones, secondary.milestones));
    setField("approvalCheckpoints", concatWithUniqueIds(primary.approvalCheckpoints, secondary.approvalCheckpoints));

    const mergedDependencies = concatWithUniqueIds(primary.dependencies, secondary.dependencies).map((dep) => {
      // The secondary code disappears once its card is deleted; repoint any dependency at the survivor.
      if (secondaryCode && primaryCode && dep.relatedProjectCode === secondaryCode) {
        return { ...dep, relatedProjectCode: primaryCode };
      }
      return dep;
    });
    setField("dependencies", mergedDependencies);

    if (Array.isArray(primary.aiDrafts)) {
      // Keep the primary's AI drafts but drop stale duplicate-candidate rows pointing at the removed card.
      const cleanedDrafts = primary.aiDrafts.map((draft) => {
        if (draft && typeof draft === "object" && Array.isArray((draft as Record<string, unknown>).duplicateCandidates)) {
          const candidates = ((draft as Record<string, unknown>).duplicateCandidates as Array<Record<string, unknown>>).filter(
            (candidate) => candidate?.projectId !== secondaryId,
          );
          return { ...(draft as Record<string, unknown>), duplicateCandidates: candidates };
        }
        return draft;
      });
      setField("aiDrafts", cleanedDrafts);
    }

    const primaryLikes = typeof primary.likeCount === "number" ? Math.max(0, Math.floor(primary.likeCount)) : 0;
    const secondaryLikes = typeof secondary.likeCount === "number" ? Math.max(0, Math.floor(secondary.likeCount)) : 0;
    setField("likeCount", primaryLikes + secondaryLikes);

    mergedFields.updatedAt = { timestampValue: new Date().toISOString() };
    maskPaths.push("updatedAt");

    // --- Reassign the secondary's comments to the primary (bypasses the client projectId immutability rule) ---
    let commentsMoved = 0;
    const commentDocs = await firestoreRunQuery({
      from: [{ collectionId: "comments" }],
      where: { fieldFilter: { field: { fieldPath: "projectId" }, op: "EQUAL", value: { stringValue: secondaryId } } },
      limit: 500,
    });
    for (const commentDoc of commentDocs) {
      const commentId = commentDoc.name?.split("/").pop();
      if (!commentId) continue;
      await firestoreCall(`comments/${commentId}?updateMask.fieldPaths=projectId`, {
        method: "PATCH",
        body: { fields: { projectId: { stringValue: primaryId } } },
      });
      commentsMoved += 1;
    }
    if (commentDocs.length >= 500) {
      console.warn(`[projects/merge] comment reassignment capped at 500 for secondary=${secondaryId}; some comments may remain.`);
    }

    // --- Merge planning notes into the primary (primary-preferred fill), then remove the secondary's ---
    const planningTextFields = [
      "publicGoal", "publicAudience", "publicValue", "publicOutcomes",
      "internalComments", "internalRisks", "internalBlockers", "sensitiveDependencies",
    ];
    const [primaryPlanningDoc, secondaryPlanningDoc] = await Promise.all([
      firestoreCall(`projectPlanning/${primaryId}`).catch(() => null),
      firestoreCall(`projectPlanning/${secondaryId}`).catch(() => null),
    ]);
    if (primaryPlanningDoc?.fields || secondaryPlanningDoc?.fields) {
      const primaryPlanning = primaryPlanningDoc?.fields ? parseFirestoreDocument(primaryPlanningDoc as { name?: string; fields?: Record<string, Record<string, unknown>> }) : {};
      const secondaryPlanning = secondaryPlanningDoc?.fields ? parseFirestoreDocument(secondaryPlanningDoc as { name?: string; fields?: Record<string, Record<string, unknown>> }) : {};
      const planningFields: Record<string, Record<string, unknown>> = {
        projectId: { stringValue: primaryId },
        updatedAt: { timestampValue: new Date().toISOString() },
      };
      const planningMask = ["projectId", "updatedAt"];
      for (const field of planningTextFields) {
        const primaryValue = typeof primaryPlanning[field] === "string" ? (primaryPlanning[field] as string) : "";
        const secondaryValue = typeof secondaryPlanning[field] === "string" ? (secondaryPlanning[field] as string) : "";
        const chosen = primaryValue.trim() ? primaryValue : secondaryValue;
        if (chosen) {
          planningFields[field] = { stringValue: chosen };
          planningMask.push(field);
        }
      }
      const planningMaskQuery = planningMask.map((path) => `updateMask.fieldPaths=${encodeURIComponent(path)}`).join("&");
      await firestoreCall(`projectPlanning/${primaryId}?${planningMaskQuery}`, { method: "PATCH", body: { fields: planningFields } });
    }

    // --- Persist the merged fields onto the primary project ---
    const projectMaskQuery = maskPaths.map((path) => `updateMask.fieldPaths=${encodeURIComponent(path)}`).join("&");
    await firestoreCall(`projects/${primaryId}?${projectMaskQuery}`, { method: "PATCH", body: { fields: mergedFields } });

    // --- Delete the secondary project and its planning doc (best-effort on a missing planning doc) ---
    await firestoreCall(`projects/${secondaryId}`, { method: "DELETE" });
    await firestoreCall(`projectPlanning/${secondaryId}`, { method: "DELETE" }).catch(() => undefined);

    auditLog("project_merge", { primaryId, secondaryId, primaryCode, secondaryCode, commentsMoved, actorUid: verifiedUser.uid });
    return res.json({
      success: true,
      mergedId: primaryId,
      commentsMoved,
      message: `Merged ${secondaryCode || "the other card"} into ${primaryCode || "the selected card"}.${commentsMoved > 0 ? ` Moved ${commentsMoved} comment${commentsMoved === 1 ? "" : "s"}.` : ""}`,
    });
  } catch (error) {
    console.error("Project merge failed:", error instanceof Error ? error.message : error);
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to merge projects right now. Please try again later." });
  }
});

app.get("/api/debug/env", (req, res) => {
  // Never expose environment/secret diagnostics in production deployments.
  if (isProduction || isVercel) {
    return res.status(404).json({ error: "Not found" });
  }
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

    const adminGate = await requireCanManageGlobalSettings(verifiedUser);
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
    const pmApproachAllowed = storedSettings.aiPmApproachEnabled === true;
    const enabledProviders = Array.isArray(storedSettings.enabledProviders) && storedSettings.enabledProviders.length > 0
      ? storedSettings.enabledProviders
      : [storedSettings.activeProvider ?? "gemini"];
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
    if (feature === "pmApproach" && !pmApproachAllowed) {
      return res.status(403).json({ error: "Project management approach AI is disabled in settings." });
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
    if (!enabledProviders.includes(provider)) {
      return res.status(403).json({ error: "Selected provider is disabled in admin settings." });
    }
    if (typeof model !== "string" || model.trim().length === 0) {
      return res.status(400).json({ error: "Model is required" });
    }

    let effectivePrompt = prompt.trim();
    if (feature === "publicNarrative") {
      const projects = await fetchProjectsForPublicNarrative();
      effectivePrompt = buildPublicNarrativePrompt(effectivePrompt, storedSettings, projects);
    }

    auditLog("admin_ai_usage_started", {
      requestId,
      actorUid: verifiedUser.uid,
      actorEmail: verifiedUser.email,
      provider,
      model,
      feature,
      promptLength: effectivePrompt.length,
      hasSystemInstruction: typeof systemInstruction === "string" && systemInstruction.length > 0,
      ip: clientIp,
    });

    let responseText = "";

    if (provider === "gemini") {
      if (!process.env.GEMINI_API_KEY) throw new Error("Gemini provider is not configured");
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model,
        contents: effectivePrompt,
        config: { systemInstruction }
      });
      responseText = response.text || "";
    } else if (provider === "openai") {
      if (!process.env.OPENAI_API_KEY) throw new Error("OpenAI provider is not configured");
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const messages: Array<{ role: "system" | "user"; content: string }> = [];
      if (systemInstruction) messages.push({ role: "system", content: systemInstruction });
      messages.push({ role: "user", content: effectivePrompt });

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
        messages: [{ role: "user", content: effectivePrompt }]
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
      messages.push({ role: "user", content: effectivePrompt });

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
      messages.push({ role: "user", content: effectivePrompt });

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
      messages.push({ role: "user", content: effectivePrompt });

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
    const { status, message } = classifyAiError(error);
    res.status(status).json({ error: message });
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
    const projectAlignment = ensureFirebaseProjectAlignment(token);
    if (projectAlignment.ok === false) {
      return res.status(409).json({ error: projectAlignment.error });
    }
    const adminGate = await requireCanManageGlobalSettings(verifiedUser);
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
    const isCredential =
      /credentials|FIREBASE_SERVICE_ACCOUNT|not configured|access token|Permission denied|403|invalid_grant/i.test(
        detail,
      );
    const isPayload = /entity\.too\.large|too large|413/i.test(detail);
    const isTimeout = /ETIMEDOUT|timeout|aborted|ECONNRESET|socket/i.test(detail);
    if (isCredential) {
      return res.status(503).json({
        error: `${detail} If this is production, set FIREBASE_SERVICE_ACCOUNT_JSON in Vercel and redeploy.`,
      });
    }
    if (isPayload) {
      return res.status(413).json({ error: detail });
    }
    if (isTimeout) {
      return res.status(503).json({ error: "Saving settings took too long. Check Firestore/Vercel and try again." });
    }
    return res.status(500).json({ error: detail });
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

    const adminGate = await requireCanManageGlobalSettings(verifiedUser);
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
    const mirroredUsers = documents.map((doc) => {
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

    const usersByUid = new Map(mirroredUsers.map((user) => [user.uid, user]));
    if (adminAuth) {
      let pageToken: string | undefined = undefined;
      do {
        const page = await adminAuth.listUsers(1000, pageToken);
        for (const authUser of page.users) {
          if (usersByUid.has(authUser.uid)) continue;
          usersByUid.set(authUser.uid, {
            uid: authUser.uid,
            email: authUser.email || "",
            displayName: authUser.displayName || "",
            role: "viewer",
            permissions: defaultPermissionsForRole("viewer"),
            status: authUser.disabled ? "disabled" : "active",
            createdAt: authUser.metadata.creationTime || undefined,
            updatedAt: authUser.metadata.lastRefreshTime || authUser.metadata.lastSignInTime || undefined,
            lastRoleChangedAt: undefined,
            lastRoleChangedBy: undefined,
          });
        }
        pageToken = page.pageToken;
      } while (pageToken);
    }

    const users = Array.from(usersByUid.values()).sort((a, b) => a.email.localeCompare(b.email));
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

app.post("/api/admin/users/delete", async (req, res) => {
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
    if (targetUid === verifiedUser.uid) {
      return res.status(400).json({ error: "You cannot remove your own account." });
    }

    // Resolve the target's role from Auth claims when available, otherwise from
    // the Firestore mirror (covers mirror-only orphans with no Auth record).
    const lookup = await identityToolkitCall("/accounts:lookup", { localId: [targetUid] });
    const authUser = ((lookup.users as Array<Record<string, unknown>> | undefined) || [])[0];
    const authClaims = authUser && typeof authUser.customAttributes === "string"
      ? (JSON.parse(authUser.customAttributes) as Record<string, unknown>)
      : {};
    const mirror = await getUserMirrorRoleAndPermissions(targetUid);
    const targetRole = mirror.role || normalizeRoleFromClaims(authClaims);
    const email = String(authUser?.email || "");

    if (!authUser && !mirror.role) {
      return res.status(404).json({ error: "Target user not found" });
    }
    if (callerRole !== "owner" && targetRole === "owner") {
      return res.status(403).json({ error: "Only owners can remove owner accounts" });
    }
    if (targetRole === "owner") {
      const owners = await countOwnersFromUsersMirror();
      if (owners <= 1) return res.status(400).json({ error: "Cannot remove the last remaining owner" });
    }

    // Remove the Firebase Auth account (if it exists).
    if (authUser) {
      await identityToolkitCall("/accounts:delete", { localId: targetUid });
    }
    // Remove the Firestore mirror doc, tolerating an already-missing document.
    try {
      await firestoreCall(`users/${targetUid}`, { method: "DELETE" });
    } catch (mirrorError) {
      const message = mirrorError instanceof Error ? mirrorError.message : "";
      if (!/not[_\s]?found/i.test(message)) throw mirrorError;
    }

    await writeAuditLog({
      actorUid: verifiedUser.uid,
      actorEmail: verifiedUser.email || "",
      targetUid,
      targetEmail: email,
      action: "delete-user",
      oldRole: targetRole,
    });
    return res.json({ success: true, message: "User permanently removed." });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to remove user" });
  }
});

app.get("/api/user/preferences", async (req, res) => {
  try {
    const token = getBearerToken(req.headers.authorization);
    if (!token) return res.status(401).json({ error: "Authentication required" });
    const verifiedUser = await verifyFirebaseUser(token);
    if (!verifiedUser) return res.status(401).json({ error: "Invalid or expired auth token" });
    const prefs = await getUserPreferences(verifiedUser.uid);
    return res.json({ preferences: prefs });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to load preferences" });
  }
});

app.post("/api/user/preferences", async (req, res) => {
  try {
    const token = getBearerToken(req.headers.authorization);
    if (!token) return res.status(401).json({ error: "Authentication required" });
    const verifiedUser = await verifyFirebaseUser(token);
    if (!verifiedUser) return res.status(401).json({ error: "Invalid or expired auth token" });

    const current = await getUserPreferences(verifiedUser.uid);
    const next = {
      siteTourCompleted: typeof req.body?.siteTourCompleted === "boolean" ? req.body.siteTourCompleted : current.siteTourCompleted,
      siteTourDismissed: typeof req.body?.siteTourDismissed === "boolean" ? req.body.siteTourDismissed : current.siteTourDismissed,
    };
    await saveUserPreferences(verifiedUser.uid, next);
    return res.json({ success: true, preferences: next });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to save preferences" });
  }
});

// Ensure API callers never receive the SPA shell for unknown API routes.
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found" });
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
