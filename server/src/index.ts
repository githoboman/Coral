import app from "./app";

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

  console.log("[startup] Coral Express Server running in agent-wallet mode.");
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
