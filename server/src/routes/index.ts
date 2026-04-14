import { Router, Request, Response } from "express";
import authRouter from "./auth";
import usersRouter from "./users";
import tasksRouter from "./tasks";
import eventsRouter from "./events";
import waitlistRouter from "./waitlist";
import accountRouter from "./account";
import chatRouter from "./chat";

import checkinRouter from "./checkin";
import taskPointsRouter from "./taskPoints";
import subscriptionRoutes from "./subscription";

import chatsRouter from "./chats";
import telegramRouter from "./telegram";
import priceRouter from "./price";
import proactiveRouter from "./proactive";
import bridgeTransactionsRouter from "./bridgeTransactions";
import walletRouter from "./wallet";


const router = Router();

router.use("/auth", authRouter);
router.use(usersRouter);
router.use(tasksRouter);
router.use(eventsRouter);
router.use(waitlistRouter);
router.use(accountRouter);

router.use("/checkin", checkinRouter);
router.use("/task-points", taskPointsRouter);
router.use("/subscription", subscriptionRoutes);

router.use("/chat", chatRouter);
router.use("/chats", chatsRouter);
router.use("/telegram", telegramRouter);
router.use("/price", priceRouter);
router.use("/proactive", proactiveRouter);
router.use("/bridge", bridgeTransactionsRouter);
router.use(walletRouter);


router.get("/info", (_req: Request, res: Response) => {
  res.json({
    name: "Tovira Express Server",
    version: "3.0.0",
    description:
      "Express TypeScript server for Tovira - Powered by Supabase + Sui",
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
      taskPoints: [
        "GET /api/task-points/claimable",
        "POST /api/task-points/request-claim",
        "GET /api/task-points/stats/:user_id",
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
      account: ["GET /api/account/:user_id", "GET /api/leaderboard"],

      checkin: ["GET /api/checkin/status", "POST /api/checkin/request-ticket"],
      proactive: [
        "POST /api/proactive/track",
        "DELETE /api/proactive/track/:itemId",
        "GET /api/proactive/tracked",
        "GET /api/proactive/events",
        "GET /api/proactive/preferences",
        "PUT /api/proactive/preferences",
        "GET /api/proactive/status",
        "GET /api/proactive/suggestions",
        "POST /api/proactive/suggestions/:id/respond",
        "POST /api/proactive/simulate",
        "GET /api/proactive/simulations",
        "POST /api/proactive/simulations/:id/execute",
      ],
      wallet: [
        "GET /api/wallet/balance",
        "POST /api/wallet/charge"
      ],
    },
    storage: "Supabase",
    blockchain: "Sui",
  });
});

router.get("/status", (_req: Request, res: Response) => {
  res.json({
    status: "running",
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    environment: process.env.NODE_ENV || "development",
    storage: "Supabase",
    blockchain: "Sui Testnet",
  });
});

export default router;
