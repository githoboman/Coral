import { Router, Request, Response } from "express";
import authRouter from "./auth"; // NEW
import usersRouter from "./users";
import tasksRouter from "./tasks";
import eventsRouter from "./events";
import waitlistRouter from "./waitlist";
import accountRouter from "./account";
import chatRouter from "./chat";
import checkinRouter from "./checkin";

const router = Router();

router.use("/auth", authRouter);
router.use(usersRouter);
router.use(tasksRouter);
router.use(eventsRouter);
router.use(waitlistRouter);
router.use(accountRouter);
router.use(chatRouter);
router.use("/checkin", checkinRouter);

router.get("/info", (_req: Request, res: Response) => {
  res.json({
    name: "Tovira Express Server",
    version: "2.0.0",
    description:
      "Express TypeScript server for Tovira - Powered by Walrus + Sui",
    timestamp: new Date().toISOString(),
    endpoints: {
      auth: ["POST /api/auth/verify-and-register", "GET /api/auth/check-user"],
      users: ["GET /api/fetch-user", "POST /api/update-user"],
      tasks: [
        "POST /api/tasks",
        "POST /api/tasks/bulk",
        "GET /api/tasks",
        "GET /api/tasks/:task_id",
        "PATCH /api/tasks/:task_id",
        "DELETE /api/tasks/:task_id",
        "POST /api/tasks/:task_id/complete",
        "GET /api/tasks/stats/:user_id",
      ],
      events: [
        "POST /api/events",
        "POST /api/events/bulk",
        "GET /api/events",
        "GET /api/events/:event_id",
        "PATCH /api/events/:event_id",
        "DELETE /api/events/:event_id",
        "GET /api/events/stats/:user_id",
      ],
      waitlist: ["POST /api/waitlist/verify", "GET /api/waitlist/info"],
      account: [
        "GET /api/account/:user_id",
        "GET /api/leaderboard",
        "POST /api/add-points/:user_id",
      ],
      chat: [
        "POST /api/chat",
        "POST /api/chat/stream",
        "GET /api/chats/:userId",
        "GET /api/chats/:chatId/messages",
      ],
    },
  });
});

router.get("/status", (_req: Request, res: Response) => {
  res.json({
    status: "running",
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    environment: process.env.NODE_ENV || "development",
    storage: "Walrus Decentralized Network",
    blockchain: "Sui Testnet",
  });
});

export default router;
