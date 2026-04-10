import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import path from "path";
import { readFile } from "node:fs/promises";
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

dotenv.config();

const ALLOWED_PROVIDERS = new Set(["gemini", "openai", "anthropic", "gemma"]);
const AI_RATE_LIMIT_WINDOW_MS = 60_000;
const AI_RATE_LIMIT_MAX_REQUESTS = 20;
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

function claimIncludesGroup(claims: Record<string, unknown>, allowedGroups: string[]): boolean {
  const groups = claims.groups;
  if (!Array.isArray(groups)) return false;
  return groups.some((group) => typeof group === "string" && allowedGroups.includes(group));
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
  if (user.claims.admin !== true) {
    return { ok: false, status: 403, error: "Admin role required" };
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
  const webApiKey = process.env.FIREBASE_WEB_API_KEY || process.env.VITE_FIREBASE_API_KEY;
  if (!webApiKey) {
    throw new Error("Firebase Web API key is not configured on the server");
  }

  const url = `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${webApiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
  });

  if (!response.ok) {
    return null;
  }

  const data = await response.json() as {
    users?: Array<{ localId?: string; email?: string; customAttributes?: string }>;
  };

  const user = data.users?.[0];
  if (!user?.localId) {
    return null;
  }

  let claims: Record<string, unknown> = {};
  if (user.customAttributes) {
    try {
      claims = JSON.parse(user.customAttributes);
    } catch {
      claims = {};
    }
  }

  return {
    uid: user.localId,
    email: user.email || null,
    claims,
  };
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

async function startServer() {
  const app = express();
  const PORT = 3000;
  const allowedOrigins = getAllowedCorsOrigins();
  const isProduction = process.env.NODE_ENV === "production";
  const devOrigins = ["http://localhost:3000", "http://127.0.0.1:3000"];

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
      throw new Error(
        "UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required in production for distributed AI rate limiting.",
      );
    }
    console.warn("Upstash Redis credentials missing; using in-memory AI rate limiting for non-production only.");
  }

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/api/ai/generate", async (req, res) => {
    const requestId = crypto.randomUUID();
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

      const { prompt, provider, systemInstruction } = req.body;

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

      auditLog("admin_ai_usage_started", {
        requestId,
        actorUid: verifiedUser.uid,
        actorEmail: verifiedUser.email,
        provider,
        promptLength: prompt.length,
        hasSystemInstruction: typeof systemInstruction === "string" && systemInstruction.length > 0,
        ip: clientIp,
      });

      let responseText = "";

      if (provider === "gemini") {
        if (!process.env.GEMINI_API_KEY) throw new Error("Gemini provider is not configured");
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const response = await ai.models.generateContent({
          model: "gemini-2.5-pro",
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
          model: "gpt-4o",
          messages
        });
        responseText = response.choices[0]?.message?.content || "";
      } else if (provider === "anthropic") {
        if (!process.env.ANTHROPIC_API_KEY) throw new Error("Anthropic provider is not configured");
        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const response = await anthropic.messages.create({
          model: "claude-3-7-sonnet-20250219",
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
          model: process.env.GEMMA_MODEL_NAME || "gemma-7b-it",
          messages
        });
        responseText = response.choices[0]?.message?.content || "";
      }

      auditLog("admin_ai_usage_succeeded", {
        requestId,
        actorUid: verifiedUser.uid,
        actorEmail: verifiedUser.email,
        provider,
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
    const requestId = crypto.randomUUID();
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
    const requestId = crypto.randomUUID();
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

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    const indexPath = path.join(distPath, "index.html");
    app.get("*", (req, res) => {
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
}

startServer();
