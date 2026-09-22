import { Router, Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { verifyPersonalMessageSignature } from "@mysten/sui/verify";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { createToken, revokeToken, revokeAllTokens, revokeDeviceTokens, validateToken } from "../services/tokenService";

import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { normalizeAddr } from "../utils/address";

const router = Router();

const nonceStore = new Map<string, { nonce: string, expires: number }>();

const network = (process.env.SUI_NETWORK || "testnet") as "testnet" | "mainnet";
const suiClient = new SuiClient({ url: getFullnodeUrl(network) });
const isProduction = process.env.NODE_ENV === "production";

// Re-export so existing consumers of `normalizeAddr` from this file still work
export { normalizeAddr } from "../utils/address";

/**
 * GET /api/auth/verify
 * Lightweight check to resume a session without signing a new message.
 * Verifies the httpOnly cookie and returns the user's profile if authenticated.
 */
router.get("/verify", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const normalizedAddr = normalizeAddr(req.user!.wallet_address);
    res.json({ exists: true, is_onboarded: true, user: { wallet_address: normalizedAddr } });
  } catch (error) {
    console.error("Error in /verify:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/nonce", (req: Request, res: Response) => {
  const { wallet_address } = req.query;
  if (!wallet_address || typeof wallet_address !== "string") {
    res.status(400).json({ error: "Missing wallet_address" });
    return;
  }
  const normalizedAddr = normalizeAddr(wallet_address);
  const nonce = crypto.randomBytes(32).toString("hex");
  nonceStore.set(normalizedAddr, { nonce, expires: Date.now() + 1000 * 60 * 5 }); // 5 mins
  console.log(`[AUTH] Nonce generated for ${normalizedAddr}: ${nonce}`);
  res.json({ nonce });
});

router.post("/login", async (req: Request, res: Response) => {
  try {
    const { wallet_address, signature, device_name } = req.body;
    if (!wallet_address || !signature) {
      res.status(400).json({ error: "Missing wallet_address or signature" });
      return;
    }

    const normalizedWallet = normalizeAddr(wallet_address);
    const storedData = nonceStore.get(normalizedWallet);
    
    if (!storedData) {
      console.warn(`[AUTH] Login failed: No nonce found for ${normalizedWallet}`);
      res.status(401).json({ error: "Nonce expired or not requested" });
      return;
    }
    
    if (storedData.expires < Date.now()) {
      console.warn(`[AUTH] Login failed: Nonce expired for ${normalizedWallet}`);
      nonceStore.delete(normalizedWallet);
      res.status(401).json({ error: "Nonce expired" });
      return;
    }

    // Must match the message the client signs in AuthProvider.tsx exactly
    const expectedMessage = `Welcome to Coral!\n\nClick to sign in and accept the Coral Terms of Service.\n\nThis request will not trigger a blockchain transaction or cost any gas fees.\n\nNonce: ${storedData.nonce}`;
    const message = new TextEncoder().encode(expectedMessage);

    console.log(`[AUTH] Verifying signature for ${normalizedWallet}...`);
    
    let derivedAddress = "";

    if (normalizedWallet.startsWith("0x") && normalizedWallet.length === 42) {
      // EVM signature verification
      const { verifyMessage } = await import("viem");
      const isValid = await verifyMessage({
        address: normalizedWallet as `0x${string}`,
        message: expectedMessage,
        signature: signature as `0x${string}`,
      });
      if (!isValid) {
        throw new Error("EVM signature verification failed");
      }
      derivedAddress = normalizedWallet;
    } else {
      // Sui signature verification
      const pubKey = await verifyPersonalMessageSignature(message, signature, {
        client: suiClient,
      });
      derivedAddress = normalizeAddr(pubKey.toSuiAddress());
    }
    
    if (derivedAddress !== normalizedWallet) {
      console.warn(`[AUTH] Address mismatch: Derived ${derivedAddress} vs Provided ${normalizedWallet}`);
      res.status(401).json({ error: "Signature mapped to different address", detail: `Expected ${normalizedWallet}, got ${derivedAddress}` });
      return;
    }

    console.log(`[AUTH] Signature verified successfully for ${normalizedWallet}`);
    nonceStore.delete(normalizedWallet);

    const dbWallet = normalizedWallet;

    // Issue a secure server-side token (HMAC-SHA256)
    const name = typeof device_name === "string" && device_name.trim()
      ? device_name.trim()
      : (req.headers["user-agent"]?.slice(0, 120) ?? "Unknown device");

    // Duplicate token guard: if request already has a valid cookie for this user, reuse it.
    const existingRawToken = req.cookies?.auth_token;
    let reused = false;
    
    if (existingRawToken) {
      const existingUserId = await validateToken(existingRawToken);
      // Compare case-insensitively for the guard
      if (existingUserId && normalizeAddr(existingUserId) === normalizedWallet) {
        reused = true;
        // Re-set the cookie to extend expiry
        const expiresInDays = parseInt(process.env.TOKEN_EXPIRES_DAYS || '7', 10);
        const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
        
        res.cookie("auth_token", existingRawToken, {
          httpOnly: true,
          secure: isProduction,
          sameSite: isProduction ? "none" : "lax",
          expires: expiresAt,
        });
        
        res.json({ success: true, wallet_address: dbWallet, reused: true });
        return;
      }
    }

    if (!reused) {
      // No valid cookie found. Delete old tokens for this device to prevent bloat.
      await revokeDeviceTokens(dbWallet, name);

      // Generate new token
      const { rawToken, expiresAt } = await createToken(dbWallet, name);

      // Send raw token exclusively via httpOnly cookie — never in the response body
      res.cookie("auth_token", rawToken, {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? "none" : "lax",
        expires: expiresAt,
      });

      res.json({ success: true, wallet_address: dbWallet, reused: false });
    }
  } catch (err: any) {
    console.error("Login error:", err);
    res.status(401).json({ error: "Invalid signature", detail: err.message });
  }
});

/**
 * POST /api/auth/logout
 */
router.post("/logout", requireAuth, async (req: AuthRequest, res: Response) => {
  const rawToken = req.cookies?.auth_token;
  if (rawToken) {
    await revokeToken(rawToken);
  }
  res.clearCookie("auth_token", { 
    httpOnly: true, 
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax" 
  });
  res.json({ success: true, message: "Logged out successfully." });
});

/**
 * POST /api/auth/logout-all
 */
router.post("/logout-all", requireAuth, async (req: AuthRequest, res: Response) => {
  await revokeAllTokens(req.user!.wallet_address);
  res.clearCookie("auth_token", { 
    httpOnly: true, 
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax" 
  });
  res.json({ success: true, message: "All sessions revoked." });
});

export default router;
