// ============================================================
// server/index.ts
//
// Changes from previous version:
//
//   1. AUTH — requireRelayerAuth middleware applied to all routes
//      except GET /health. Pass x-api-key header or ?api_key= query param.
//      Same adminKey already in config.server.adminKey.
//
//   2. IKA HEALTH — /health now checks Ika connectivity via
//      ikaClient.getEpoch(). Returns status "degraded" if disconnected
//      so your monitoring can catch signing failures before users do.
//
//   3. BIGINT SERIALIZATION — replaced manual serializeRequest /
//      deserializeRequest with a single bigintReplacer / bigintReviver
//      JSON pair. Any BigInt field in BridgeRequest is handled
//      automatically — no more manual updates when fields change.
// ============================================================

import express, { Request, Response, NextFunction } from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { Queue, Worker, Job } from "bullmq";
import IORedis from "ioredis";
import rateLimit from "express-rate-limit";
import { BridgeRequest } from "../types";
import { config } from "../config";
import { logger } from "../utils/logger";
import { loadBridgeState } from "../ika/dwalletManager";
import { getIkaClient } from "../ika/client";
import { releaseSui, setContractPaused } from "../chains/sui";
import { sendEthViaDWallet } from "../chains/evm";
import { sendSolViaDWallet } from "../chains/solana";
import { startSuiListener } from "../relayer/suiListener";
import { startEvmListener } from "../relayer/evmListener";
import { startSolanaListener } from "../relayer/solanaListener";

// ── Redis URL parser (unchanged) ──────────────────────────────────────────────

function parseRedisUrl(url: string): {
  host: string;
  port: number;
  password?: string;
  username?: string;
  db?: number;
  tls?: object;
} {
  try {
    const parsed = new URL(url);
    const isTls = parsed.protocol === "rediss:" || parsed.port === "6380";
    return {
      host: parsed.hostname || "localhost",
      port: parseInt(parsed.port || "6379"),
      ...(parsed.password && { password: decodeURIComponent(parsed.password) }),
      ...(parsed.username &&
        parsed.username !== "default" && {
          username: decodeURIComponent(parsed.username),
        }),
      ...(parsed.pathname &&
        parsed.pathname !== "/" && { db: parseInt(parsed.pathname.slice(1)) }),
      ...(isTls && { tls: {} }),
    };
  } catch {
    return { host: "localhost", port: 6379 };
  }
}

const redisOpts = parseRedisUrl(config.redis.url);

const bullmqConnection = {
  ...redisOpts,
  maxRetriesPerRequest: null as null,
};

export const redis = new IORedis({
  ...redisOpts,
  maxRetriesPerRequest: null,
  lazyConnect: true,
});

redis.on("error", (err) => {
  logger.error("Redis connection error", err);
});

// ── Bridge state ──────────────────────────────────────────────────────────────

const bridgeState = loadBridgeState();
if (!bridgeState) {
  logger.error("No bridge state found — run pnpm setup first");
  process.exit(1);
}
const state = bridgeState!;

// ── BigInt-safe JSON replacer / reviver ───────────────────────────────────────
//
// Replaces the old manual serializeRequest / deserializeRequest pair.
// Any BigInt value is stored as the string "__bigint__<value>" in the queue.
// On dequeue, reviver restores it automatically.
//
// Usage:
//   Serialize: JSON.parse(JSON.stringify(obj, bigintReplacer))
//   Deserialize: JSON.parse(jsonString, bigintReviver)
//
// This handles any future BigInt fields added to BridgeRequest without
// requiring manual updates to serialize/deserialize functions.

function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? `__bigint__${value.toString()}` : value;
}

function bigintReviver(_key: string, value: unknown): unknown {
  if (typeof value === "string" && value.startsWith("__bigint__")) {
    return BigInt(value.slice(10));
  }
  return value;
}

// BullMQ stores job data as JSON internally. We round-trip through our
// replacer/reviver to produce a plain object with no BigInt fields.
type SerializedBridgeRequest = Record<string, unknown>;

function serializeRequest(request: BridgeRequest): SerializedBridgeRequest {
  return JSON.parse(JSON.stringify(request, bigintReplacer));
}

function deserializeRequest(data: SerializedBridgeRequest): BridgeRequest {
  return JSON.parse(JSON.stringify(data), bigintReviver) as BridgeRequest;
}

// ── Bridge request queue ──────────────────────────────────────────────────────

const QUEUE_NAME = "bridge-requests";

const bridgeQueue = new Queue<SerializedBridgeRequest, void, string>(
  QUEUE_NAME,
  {
    connection: bullmqConnection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 10_000 },
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 500 },
    },
  },
);

// ── In-memory status map + WebSocket broadcast ────────────────────────────────

const requestStatuses = new Map<
  string,
  SerializedBridgeRequest & { jobId: string }
>();
const wsClients = new Set<WebSocket>();

function broadcast(event: object) {
  const msg = JSON.stringify(event, bigintReplacer);
  for (const client of wsClients) {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  }
}

// ── Auth middleware ───────────────────────────────────────────────────────────
//
// Applied to all routes except GET /health (monitoring must be unauthenticated).
// Accepts key via:
//   - Header:  x-api-key: <key>
//   - Query:   ?api_key=<key>
//
// Set RELAYER_ADMIN_KEY in your .env — same value as config.server.adminKey.

function requireRelayerAuth(req: Request, res: Response, next: NextFunction) {
  const key =
    (req.headers["x-api-key"] as string | string[] | undefined) ||
    (req.query.api_key as string | undefined);

  if (!key || key !== config.server.adminKey) {
    logger.warn("Unauthorized relayer API request", {
      ip: req.ip,
      path: req.path,
      method: req.method,
    });
    return res.status(401).json({ error: "Unauthorized" });
  }

  next();
}

// ── Express app ───────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// 100 requests per minute per IP — prevents abuse while allowing normal use
app.use(
  rateLimit({
    windowMs: 60_000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests, please slow down." },
  }),
);

// ── Health — no auth, must be reachable by uptime monitors ───────────────────
//
// Now includes Ika connectivity check.
// Returns status "ok" | "degraded" so monitoring tools can alert
// on Ika disconnects before they cause silent signing failures.

app.get("/health", async (_req, res) => {
  const queueCounts = await bridgeQueue.getJobCounts(
    "active",
    "waiting",
    "failed",
    "completed",
  );

  let ikaStatus: string;
  let ikaConnected = false;

  try {
    const ikaClient = await getIkaClient();
    // getEpoch() is a lightweight connectivity probe — no state changes
    const epoch = await ikaClient.getEpoch();
    ikaStatus = `connected (epoch ${epoch})`;
    ikaConnected = true;
  } catch (err: any) {
    ikaStatus = `disconnected: ${err?.message || "unknown error"}`;
    logger.warn("Ika health check failed", { err });
  }

  const overallStatus = ikaConnected ? "ok" : "degraded";

  res.status(ikaConnected ? 200 : 503).json({
    status: overallStatus,
    uptime: process.uptime(),
    queue: queueCounts,
    ika: ikaStatus,
    timestamp: new Date().toISOString(),
  });
});

// ── All routes below require auth ─────────────────────────────────────────────

app.get("/bridge/:id", requireRelayerAuth, (req, res) => {
  const request = requestStatuses.get(req.params.id as string);
  if (!request) {
    return res.status(404).json({ error: "Bridge request not found" });
  }
  res.json(request);
});

app.get("/bridge", requireRelayerAuth, async (_req, res) => {
  const jobs = await bridgeQueue.getJobs(
    ["active", "waiting", "completed", "failed"],
    0,
    50,
  );
  const requests = jobs.map((job) => ({ jobId: job.id, ...job.data }));
  res.json(requests);
});

app.post("/bridge/retry/:jobId", requireRelayerAuth, async (req, res) => {
  const job = await bridgeQueue.getJob(req.params.jobId as string);
  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }
  await job.retry();
  res.json({ ok: true, message: `Job ${req.params.jobId} queued for retry` });
});

// /admin/pause — auth is now handled by requireRelayerAuth middleware
// instead of the manual adminKey check in the body. The body check is
// removed to be consistent with all other routes.
app.post("/admin/pause", requireRelayerAuth, async (req, res) => {
  const { paused } = req.body as { paused: boolean };

  if (paused) {
    await bridgeQueue.pause();
    logger.warn("Bridge queue PAUSED by admin");
  } else {
    await bridgeQueue.resume();
    logger.info("Bridge queue RESUMED by admin");
  }

  // Also pause/unpause the Move contract so lock_sui() reverts on-chain.
  // Runs after the queue change — a contract call failure won't leave the
  // queue in a wrong state.
  try {
    await setContractPaused(paused);
  } catch (err: any) {
    logger.error("Failed to set Move contract pause state", { err: err.message, paused });
    return res.status(500).json({
      ok: false,
      error: `Queue ${paused ? "paused" : "resumed"} but contract call failed: ${err.message}`,
    });
  }

  broadcast({ type: "bridge_paused", paused });
  res.json({ ok: true, paused });
});

// ── Worker ────────────────────────────────────────────────────────────────────

const worker = new Worker<SerializedBridgeRequest, void, string>(
  QUEUE_NAME,
  async (job: Job<SerializedBridgeRequest>) => {
    const request = deserializeRequest(job.data);

    logger.info(`Processing bridge job [${job.id}]`, {
      route: `${request.sourceChain} → ${request.destChain}`,
      recipient: request.recipientAddress,
      amountIn: request.amountIn.toString(),
      amountOut: request.amountOut.toString(),
    });

    const signing = serializeRequest({ ...request, status: "signing" });
    requestStatuses.set(request.id, { ...signing, jobId: job.id! });
    broadcast({ type: "bridge_update", request: signing });

    let destTxHash: string;

    if (request.sourceChain === "sui" && request.destChain === "evm") {
      destTxHash = await sendEthViaDWallet(
        request.recipientAddress,
        request.amountOut,
        state.evmDWallet,
      );
    } else if (
      request.sourceChain === "sui" &&
      request.destChain === "solana"
    ) {
      destTxHash = await sendSolViaDWallet(
        request.recipientAddress,
        request.amountOut,
        state.solanaDWallet,
      );
    } else if (
      request.sourceChain === "evm" ||
      request.sourceChain === "solana"
    ) {
      destTxHash = await releaseSui(
        request.recipientAddress,
        request.amountOut,
        request.sourceTxHash,
      );
    } else {
      throw new Error(
        `Unsupported route: ${request.sourceChain} → ${request.destChain}`,
      );
    }

    const completed = serializeRequest({
      ...request,
      status: "completed",
      destTxHash,
    });
    requestStatuses.set(request.id, { ...completed, jobId: job.id! });
    broadcast({ type: "bridge_update", request: completed });

    logger.success(`Bridge job [${job.id}] completed`, { destTxHash });
  },
  {
    connection: bullmqConnection,
    concurrency: 1,
  },
);

worker.on("failed", (job, err) => {
  if (!job) return;
  const failed = { ...job.data, status: "failed" as const, error: err.message };
  requestStatuses.set(job.data.id as string, { ...failed, jobId: job.id! });
  broadcast({ type: "bridge_update", request: failed });
  logger.error(`Bridge job [${job.id}] failed`, err);
});

// ── Chain listeners ───────────────────────────────────────────────────────────

async function onBridgeRequest(request: BridgeRequest) {
  const waiting = await bridgeQueue.getWaitingCount();
  if (waiting >= config.relayer.maxQueueSize) {
    logger.error("Queue full — dropping bridge request", {
      id: request.id,
      route: `${request.sourceChain} → ${request.destChain}`,
      waiting,
      maxQueueSize: config.relayer.maxQueueSize,
    });
    broadcast({ type: "bridge_dropped", id: request.id, reason: "queue_full" });
    return;
  }

  const serialized = serializeRequest(request);
  const job = await bridgeQueue.add(request.id, serialized);

  requestStatuses.set(request.id, { ...serialized, jobId: job.id! });
  broadcast({ type: "bridge_queued", request: serialized });

  logger.info("Bridge request queued", {
    jobId: job.id,
    id: request.id,
    route: `${request.sourceChain} → ${request.destChain}`,
  });
}

// ── Start ─────────────────────────────────────────────────────────────────────

async function start() {
  await redis.connect();
  logger.info("Redis connected");

  logger.info("Connecting to Ika network...");
  await getIkaClient();

  const cleanupFns = await Promise.all([
    startSuiListener(onBridgeRequest),
    startEvmListener(state.evmDWallet.targetChainAddress, onBridgeRequest),
    startSolanaListener(
      state.solanaDWallet.targetChainAddress,
      onBridgeRequest,
    ),
  ]);

  const httpServer = createServer(app);

  const wss = new WebSocketServer({ server: httpServer });
  wss.on("connection", (ws) => {
    wsClients.add(ws);
    ws.on("close", () => wsClients.delete(ws));
    bridgeQueue
      .getJobCounts("active", "waiting", "failed", "completed")
      .then((counts) =>
        ws.send(JSON.stringify({ type: "queue_status", counts })),
      );
  });

  const PORT = config.server.port;
  httpServer.listen(PORT, () => {
    logger.success(`Bridge server running on port ${PORT}`);
    logger.info(`  Health:    http://localhost:${PORT}/health`);
    logger.info(
      `  Requests:  http://localhost:${PORT}/bridge  (auth required)`,
    );
    logger.info(`  WebSocket: ws://localhost:${PORT}`);
  });

  const shutdown = async () => {
    logger.info("Shutting down...");
    cleanupFns.forEach((fn) => fn());
    await worker.close();
    await bridgeQueue.close();
    await redis.quit();
    httpServer.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

start().catch((err) => {
  logger.error("Fatal server error", err);
  process.exit(1);
});
