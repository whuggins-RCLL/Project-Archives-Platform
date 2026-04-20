// Keep a STATIC import at the top so Vercel's file-tracer (@vercel/node / nft)
// includes server.js in the Lambda artifact. The .js extension is required
// under Node 24 strict ESM resolution (package.json has "type": "module");
// without it Node throws ERR_MODULE_NOT_FOUND for '/var/task/server'.
import staticApp from "../server.js";
import express, { type Request, type Response, type NextFunction } from "express";

// If the static import above somehow returned undefined (which would manifest
// as a crashed Lambda), fall back to a diagnostic Express app so the caller
// gets JSON instead of Vercel's opaque FUNCTION_INVOCATION_FAILED page. Any
// per-request errors thrown by handlers inside server.ts are already caught
// by the global express error handler defined at the bottom of server.ts.
let handler: express.Express;
if (staticApp && typeof staticApp === "function") {
  handler = staticApp as unknown as express.Express;
} else {
  const fallback = express();
  fallback.use((_req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({
      error: "Server module default export was empty",
      staticAppType: typeof staticApp,
      nodeVersion: process.version,
      isVercel: Boolean(process.env.VERCEL),
    });
  });
  handler = fallback;
}

export default handler;
