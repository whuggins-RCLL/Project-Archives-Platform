// IMPORTANT: this must be a STATIC import, not `await import("../server")`.
// Vercel's file-tracer (nft / @vercel/node) only follows static imports when
// deciding which files to include in the Lambda artifact. A dynamic import
// hides the dependency, so `server.ts` never lands at `/var/task/server` and
// every request fails with ERR_MODULE_NOT_FOUND. Runtime errors inside
// individual endpoints are caught by the per-route try/catch blocks in
// server.ts and a global express error handler.
import app from "../server";

export default app;
