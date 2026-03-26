import { SuiEventFilter } from "@mysten/sui/client";
import { BridgeRequest } from "../types";
import { parseSuiLockEvent, lockEventToBridgeRequest } from "../chains/sui";
import { getSuiClient } from "../ika/client";
import { loadBridgeState } from "../ika/dwalletManager";
import { config } from "../config";
import { logger } from "../utils/logger";
import { loadSuiKeypair, getAddress } from "../utils/executeTransaction";
import { redis } from "../server/index";

const CURSOR_KEY = "bridge:sui:cursor";

type EventCursor = { eventSeq: string; txDigest: string };

async function loadCursor(): Promise<EventCursor | null> {
  try {
    const raw = await redis.get(CURSOR_KEY);
    if (raw) return JSON.parse(raw) as EventCursor;
  } catch (err) {
    logger.warn(
      "Could not load Sui listener cursor from Redis, starting from latest",
      { err },
    );
  }
  return null;
}

async function saveCursor(cursor: EventCursor): Promise<void> {
  try {
    await redis.set(CURSOR_KEY, JSON.stringify(cursor));
  } catch (err) {
    logger.warn("Could not save Sui listener cursor to Redis", { err });
  }
}

export async function startSuiListener(
  onBridgeRequest: (request: BridgeRequest) => void,
): Promise<() => void> {
  const suiClient = getSuiClient();

  const bridgeState = loadBridgeState();
  const contract = bridgeState?.contract;

  let eventFilter: SuiEventFilter;

  if (contract?.packageId) {
    eventFilter = {
      MoveEventType: `${contract.packageId}::bridge::BridgeLockEvent`,
    };
    logger.info("Starting Sui event listener (Move contract mode)...", {
      eventType: `${contract.packageId}::bridge::BridgeLockEvent`,
      poolObjectId: contract.poolObjectId,
    });
  } else {
    const keypair = loadSuiKeypair(config.ika.suiPrivateKey);
    eventFilter = { Sender: getAddress(keypair) };
    logger.warn(
      "Move contract not deployed — Sui listener using Sender fallback.",
    );
  }

  let lastCursor: EventCursor | null = await loadCursor();

  if (!lastCursor) {
    logger.info(
      "No cursor found in Redis — fast-forwarding to current event tip...",
    );
    try {
      const { data: latestEvents } = await suiClient.queryEvents({
        query: eventFilter,
        limit: 1,
        order: "descending",
      });
      if (latestEvents.length > 0) {
        lastCursor = latestEvents[0].id as EventCursor;
        await saveCursor(lastCursor);
        logger.info("Sui cursor initialized to current tip", {
          cursor: lastCursor,
        });
      } else {
        logger.info(
          "No existing events found — will process all future events.",
        );
      }
    } catch (err) {
      logger.warn(
        "Could not fast-forward Sui cursor, will start from beginning",
        { err },
      );
    }
  } else {
    logger.info("Resuming Sui listener from Redis cursor", {
      cursor: lastCursor,
    });
  }

  let isRunning = true;

  const poll = async () => {
    while (isRunning) {
      try {
        const { data: events, nextCursor } = await suiClient.queryEvents({
          query: eventFilter,
          cursor: lastCursor,
          limit: 50,
          order: "ascending",
        });

        for (const event of events) {
          const lockEvent = parseSuiLockEvent(event);
          if (!lockEvent) continue;

          const bridgeRequest = lockEventToBridgeRequest(
            lockEvent,
            event.id.txDigest,
          );
          if (!bridgeRequest) continue;

          logger.bridge(
            `SUI → ${bridgeRequest.destChain.toUpperCase()}`,
            `${(Number(bridgeRequest.amountIn) / 1e9).toFixed(4)} SUI`,
            bridgeRequest.senderAddress,
            bridgeRequest.recipientAddress,
          );

          logger.info("Bridge request detected from Move event", {
            bridgeRequestId: lockEvent.bridgeRequestId,
            txDigest: event.id.txDigest,
            destChain: bridgeRequest.destChain,
            recipient: bridgeRequest.recipientAddress,
            amountSui: (Number(bridgeRequest.amountIn) / 1e9).toFixed(4),
          });

          onBridgeRequest(bridgeRequest);
        }

        if (nextCursor && events.length > 0) {
          lastCursor = nextCursor;
          await saveCursor(lastCursor); // persist to Redis after every batch
        }
      } catch (err) {
        logger.error("Error polling Sui events", err);
      }

      await new Promise((resolve) =>
        setTimeout(resolve, config.relayer.suiPollIntervalMs),
      );
    }
  };

  poll().catch((err) => logger.error("Sui listener crashed", err));

  logger.success("Sui event listener started", {
    mode: contract?.packageId ? "Move contract" : "Sender fallback",
    cursorStorage: "Redis",
    pollIntervalMs: config.relayer.suiPollIntervalMs,
  });

  return () => {
    isRunning = false;
    logger.info("Sui event listener stopped");
  };
}
