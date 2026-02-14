import app from "./app";

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════╗
║   Tovira Express Server Started       ║
╠════════════════════════════════════════╣
║   Environment: ${process.env.NODE_ENV || "development"}
║   Port: ${PORT}
║   URL: http://localhost:${PORT}
╚════════════════════════════════════════╝
  `);

  // Initialize Telegram Bot
  import("./services/telegramBot").then(({ getTelegramBot }) => {
    getTelegramBot();
  });

  // Initialize Task Scheduler
  import("./services/scheduler").then(({ getTaskScheduler }) => {
    getTaskScheduler().start();
  });
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
