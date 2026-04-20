// Wrap the server import so initialization crashes produce a diagnostic JSON
// response instead of Vercel's opaque FUNCTION_INVOCATION_FAILED page. Uses a
// top-level-await dynamic import so errors thrown at module-init time of
// `server.ts` surface through the try/catch.
import express, { type Request, type Response, type NextFunction } from "express";

let handler: express.Express;
let initError: string | null = null;
let initErrorName: string | null = null;

try {
  const mod = await import("../server");
  handler = (mod as { default: express.Express }).default;
} catch (e) {
  initErrorName = e instanceof Error ? e.name : "UnknownError";
  initError = e instanceof Error ? `${e.name}: ${e.message}\n${e.stack ?? ""}` : String(e);
  console.error("[api/index] Server module failed to load:", initError);
  handler = express();
  handler.use((_req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({
      error: "Server module failed to initialize",
      errorName: initErrorName,
      initError,
      nodeVersion: process.version,
      isVercel: Boolean(process.env.VERCEL),
      hasServiceAccountJson: Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON),
      hasFirebaseProjectId: Boolean(process.env.FIREBASE_PROJECT_ID),
    });
  });
}

export default handler;
