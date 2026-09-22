import { Router, Request, Response } from "express";
import authRouter from "./auth";
import priceRouter from "./price";
import walletRouter from "./wallet";
import agentWalletRouter from "./agentWallet";
import corralRouter from "./corral";

const router = Router();

router.use("/auth", authRouter);
router.use("/price", priceRouter);
router.use(walletRouter);
router.use(agentWalletRouter);
router.use(corralRouter);

router.get("/info", (_req: Request, res: Response) => {
  res.json({
    name: "Coral Express Server",
    version: "3.0.0",
    description: "Express TypeScript server for Coral — Agent Wallet",
    timestamp: new Date().toISOString(),
    endpoints: {
      auth: ["POST /api/auth/login", "GET /api/auth/verify", "POST /api/auth/logout"],
      wallet: ["GET /api/wallet/balance", "POST /api/wallet/charge"],
      agent: [
        "POST /api/agent/wallet/init",
        "GET /api/agent/wallet",
        "POST /api/agent/policy/create-tx",
        "POST /api/agent/policy/bind",
        "POST /api/agent/policy/pause-tx",
        "POST /api/agent/policy/resume-tx",
        "POST /api/agent/policy/revoke",
        "POST /api/agent/deepbook/bootstrap",
        "POST /api/agent/swap",
        "POST /api/agent/swap/schedule",
        "GET /api/agent/alerts",
      ],
    },
    storage: "PostgreSQL",
    blockchain: "EVM / Base",
  });
});

router.get("/status", (_req: Request, res: Response) => {
  res.json({
    status: "running",
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    environment: process.env.NODE_ENV || "development",
    storage: "PostgreSQL",
    blockchain: "EVM / Base",
  });
});

export default router;
