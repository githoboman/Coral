import app from "./app";
import { isSupabaseConfigured } from "./config/supabase";

const PORT = Number(process.env.PORT) || 3000;

// Bind to 0.0.0.0 (all interfaces) so Render/host port-detection reliably finds
// the open port. Without an explicit host, Node may bind IPv6-only (`::`), which
// some platforms' IPv4 scanners miss — causing a deploy "port detection timeout".
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`
╔════════════════════════════════════════╗
║   Coral Express Server Started          ║
╠════════════════════════════════════════╣
║   Environment: ${process.env.NODE_ENV || "development"}
║   Port: ${PORT}
║   URL: http://localhost:${PORT}
╚════════════════════════════════════════╝
  `);



  // These background jobs are Supabase-backed (task scheduler, leaderboard cache).
  // Coral's agent-wallet flow doesn't use them, so skip them entirely when no real
  // Supabase is configured — otherwise they spam the logs with DNS/fetch errors
  // every minute against the dummy client.
  if (isSupabaseConfigured) {
    import("./services/scheduler").then(({ getTaskScheduler }) => {
      getTaskScheduler().start();
    });
    import("./services/cacheWarmer").then(({ getCacheWarmer }) => {
      getCacheWarmer().warmup();
    });
  } else {
    console.log("[startup] Supabase not configured — skipping scheduler + cache warmer (agent-wallet mode).");
  }
});

process.on("SIGTERM", () => {
  console.log("SIGTERM signal received: closing HTTP server");
  server.close(() => {
    console.log("HTTP server closed");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("\nSIGINT signal received: closing HTTP server");
  server.close(() => {
    console.log("HTTP server closed");
    process.exit(0);
  });
});

process.on("unhandledRejection", (reason: Error, promise: Promise<any>) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  server.close(() => {
    process.exit(1);
  });
});

export default server;
