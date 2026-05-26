import { Router, Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { verifyPersonalMessageSignature } from "@mysten/sui/verify";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { createToken, revokeToken, revokeAllTokens, revokeDeviceTokens, validateToken } from "../services/tokenService";

import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import {
  UserManager,
  getUserManager as getUserManagerService,
} from "../services/userManager";
import { TicketMinter, getTicketMinter } from "../services/ticketMinter";
import getSupabaseClient from "../config/supabase";
import { getReferralService } from "../services/referralService";
import { normalizeAddr } from "../utils/address";

const supabase = getSupabaseClient();
const router = Router();

const nonceStore = new Map<string, { nonce: string, expires: number }>();

// Allowed email domains — exact match only, always lowercased before check
const ALLOWED_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "yahoo.com", "yahoo.co.uk", "yahoo.com.au", "yahoo.ca", "yahoo.fr", "yahoo.de",
  "outlook.com", "hotmail.com", "hotmail.co.uk", "live.com", "msn.com",
  "icloud.com", "me.com", "mac.com",
  "protonmail.com", "proton.me",
  "zoho.com",
  "aol.com",
  "yandex.com", "yandex.ru",
  "mail.com", "gmx.com", "gmx.net",
  "tutanota.com",
  "fastmail.com", "fastmail.fm",
  "hey.com",
]);


const network = (process.env.SUI_NETWORK || "testnet") as "testnet" | "mainnet";
const suiClient = new SuiClient({ url: getFullnodeUrl(network) });
const PACKAGE_ID = process.env.SUI_PACKAGE_ID || "";
const isProduction = process.env.NODE_ENV === "production";

let userManager: UserManager | null = null;
let ticketMinter: TicketMinter | null = null;

function getLocalUserManager(): UserManager {
  if (!userManager) userManager = getUserManagerService();
  return userManager;
}
function getLocalTicketMinter(): TicketMinter {
  if (!ticketMinter) ticketMinter = getTicketMinter();
  return ticketMinter;
}

// Re-export so existing consumers of `normalizeAddr` from this file still work
export { normalizeAddr } from "../utils/address";

async function hasClaimedOnChain(walletAddress: string): Promise<boolean> {
  if (!PACKAGE_ID) return false;

  const normalized = normalizeAddr(walletAddress);

  try {
    const result = await suiClient.queryEvents({
      query: {
        MoveEventField: {
          path: "/wallet_address",
          value: normalized,
        },
      } as any,
      limit: 1,
      order: "descending",
    });

    if (result.data.length > 0) {
      const ev = result.data[0];
      const eventType: string = (ev as any).type || "";
      if (eventType.startsWith(PACKAGE_ID)) {
        return true;
      }
    }
  } catch { }

  try {
    const page = await suiClient.queryEvents({
      query: { MoveEventType: `${PACKAGE_ID}::points::PointsClaimed` },
      limit: 50,
      order: "descending",
    });

    for (const ev of page.data) {
      const data = ev.parsedJson as any;
      if (
        data?.wallet_address &&
        normalizeAddr(data.wallet_address) === normalized
      ) {
        return true;
      }
    }

    if (page.hasNextPage && page.nextCursor) {
      let cursor: any = page.nextCursor;
      let hasNext = true;
      while (hasNext && cursor) {
        const next = await suiClient.queryEvents({
          query: { MoveEventType: `${PACKAGE_ID}::points::PointsClaimed` },
          cursor,
          limit: 50,
          order: "descending",
        });
        for (const ev of next.data) {
          const data = ev.parsedJson as any;
          if (
            data?.wallet_address &&
            normalizeAddr(data.wallet_address) === normalized
          ) {
            return true;
          }
        }
        hasNext = next.hasNextPage;
        cursor = next.nextCursor ?? null;
      }
    }

    return false;
  } catch (rpcErr) {
    console.warn(
      "[CLAIM-CHECK] queryEvents failed, using devInspect fallback:",
      rpcErr,
    );
    try {
      const minter = getLocalTicketMinter();
      return await minter.hasClaimed(walletAddress);
    } catch {
      return false;
    }
  }
}

/** Check if email is on the waitlist in Supabase */
async function isEmailOnWaitlist(email: string): Promise<boolean> {
  try {
    const normalizedEmail = email.toLowerCase().trim();
    
    // Use .or() with ilike to handle potential spaces in the database email column
    const { data, error } = await supabase
      .from('waitlist_emails')
      .select('id')
      .or(`email.ilike."${normalizedEmail}",email.ilike." ${normalizedEmail}",email.ilike."${normalizedEmail} "`)
      .maybeSingle();

    if (error) {
      console.error("[WAITLIST] Supabase lookup error:", error);
      return false;
    }
    return !!data;
  } catch (err) {
    console.error("[WAITLIST] Error checking waitlist:", err);
    return false;
  }
}

router.post(
  "/register",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const {
        email,
        wallet_address,
        username,
        first_name,
        last_name,
        preferences,
        referral_code, // provided by user if they were referred
      } = req.body;

      if (!email || typeof email !== "string") {
        res
          .status(400)
          .json({ error: "Bad Request", detail: "Email is required" });
        return;
      }
      if (!wallet_address || typeof wallet_address !== "string") {
        res
          .status(400)
          .json({ error: "Bad Request", detail: "Wallet address is required" });
        return;
      }

      const normalizedEmail = email.toLowerCase().trim();
      const normalizedWallet = normalizeAddr(wallet_address);
      const um = getLocalUserManager();

      // Conflict check using Supabase
      const existingWallet = await um.findWalletByEmail(normalizedEmail);
      if (existingWallet && existingWallet !== wallet_address) {
        res.status(409).json({
          error: "Conflict",
          detail: "This email address is already registered to another wallet.",
        });
        return;
      }

      // Email domain whitelist check — runs for every registration regardless of referral code
      const emailDomain = normalizedEmail.split("@")[1]?.toLowerCase() ?? "";
      if (!ALLOWED_EMAIL_DOMAINS.has(emailDomain)) {
        console.log(`[REGISTER] Blocked disposable/unknown email domain: ${emailDomain}`);
        res.status(400).json({
          error: "Please use a valid email address. Disposable or temporary email addresses are not accepted.",
        });
        return;
      }

      const profile = um.createUserProfile(
        normalizedEmail,
        normalizedWallet,
        false,
        0,
        {
          username: username || undefined,
          first_name: first_name || undefined,
          last_name: last_name || undefined,
          preferences: preferences || {},
        },
      );

      // Generate a unique referral code for this new user
      const referralService = getReferralService();
      try {
        const generatedCode = await referralService.generateUniqueReferralCode();
        profile.referral_code = generatedCode;
      } catch (e) {
        console.error("Failed to generate referral code for new user", e);
      }

      const result = await um.addOrUpdateUser(profile);

      if (!result) {
        res.status(500).json({
          error: "Internal Server Error",
          detail: "Failed to save user profile to database.",
        });
        return;
      }

      // If they were referred by someone, link them AFTER profile creation (to satisfy foreign keys)
      if (referral_code && typeof referral_code === "string") {
        try {
          const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip;
          const referredBy = await referralService.processReferral(normalizedWallet, referral_code, clientIp);
          if (referredBy) {
            const { error: updateError } = await supabase
              .from("user_profiles")
              .update({ referred_by: referredBy })
              .eq("wallet_address", normalizedWallet);
              
            if (updateError) {
              console.error(`[REGISTER] Failed to update user_profiles.referred_by for ${normalizedWallet}:`, updateError);
            }
          }
        } catch (refErr: any) {
          console.error(
            `[REGISTER] Failed to process referral for wallet ${normalizedWallet} with code ${referral_code}:`,
            refErr.message || refErr
          );
        }
      }

      // The referral will remain pending until the user completes their first check-in,
      // at which point the checkin route will call referralService.completeReferral().

      const fullProfile = await um.getUserProfile(normalizedWallet);

      res.json({
        success: true,
        user: fullProfile || {
          email: normalizedEmail,
          wallet_address: normalizedWallet,
          username: username || null,
        },
        message: "Profile saved successfully.",
      });
    } catch (error) {
      console.error("Error in register:", error);
      next(error);
    }
  },
);

router.post(
  "/claim-waitlist-points",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { email, wallet_address } = req.body;

      if (!email || typeof email !== "string") {
        res
          .status(400)
          .json({ error: "Bad Request", detail: "Email is required" });
        return;
      }
      if (!wallet_address || typeof wallet_address !== "string") {
        res
          .status(400)
          .json({ error: "Bad Request", detail: "Wallet address is required" });
        return;
      }

      const normalizedEmail = email.toLowerCase().trim();
      const normalizedWallet = normalizeAddr(wallet_address);
      const minter = getLocalTicketMinter();

      const alreadyClaimed = await hasClaimedOnChain(normalizedWallet);
      if (alreadyClaimed) {
        res.json({
          success: false,
          already_claimed: true,
          message: "Points already claimed.",
        });
        return;
      }

      const isWhitelisted = await isEmailOnWaitlist(normalizedEmail);
      if (!isWhitelisted) {
        res.status(403).json({
          success: false,
          eligible: false,
          message: "Email is not on the waitlist.",
        });
        return;
      }

      const claimResult =
        await minter.sponsoredClaimWaitlistPoints(normalizedWallet);

      if (!claimResult.success) {
        res.status(500).json({
          success: false,
          error: "Claim Failed",
          detail: claimResult.error || "Failed to claim points",
        });
        return;
      }

      (async () => {
        try {
          const um = getLocalUserManager();
          const existing = await um.getUserProfile(normalizedWallet);

          if (existing) {
            const updated = um.createUserProfile(
              existing.email,
              existing.wallet_address,
              true,
              existing.points_awarded + 100,
              {
                username: existing.username,
                first_name: existing.first_name,
                last_name: existing.last_name,
                preferences: existing.preferences,
                waitlist_verified_at: new Date().toISOString(),
              },
            );
            await um.addOrUpdateUser(updated);

            // Log to points_history
            try {
              const { data, error } = await supabase
                .from('points_history')
                .insert({
                  user_id: wallet_address,
                  amount: 100,
                  source: 'waitlist_points',
                  reason: 'Waitlist eligibility reward',
                  details: { email: normalizedEmail }
                });
              if (error) throw error;
            } catch (histErr) {
              console.warn("[CLAIM] Failed to log points_history:", histErr);
            }
          }
        } catch (err) {
          console.warn(
            "[CLAIM] Supabase profile update failed (non-fatal):",
            err,
          );
        }
      })();

      res.json({
        success: true,
        claimed: true,
        transaction_digest: claimResult.digest,
        points_awarded: 100,
        new_balance: claimResult.balance || 100,
        message: "Waitlist points awarded!",
      });
    } catch (error) {
      console.error("Error in claim-waitlist-points:", error);
      next(error);
    }
  },
);

router.get(
  "/check-user",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { wallet_address } = req.query;
      const normalizedWallet = wallet_address && typeof wallet_address === "string" 
        ? normalizeAddr(wallet_address) 
        : null;

      if (!normalizedWallet) {
        res
          .status(400)
          .json({ error: "Bad Request", detail: "Wallet address is required" });
        return;
      }

      console.log(
        `[CHECK-USER] ${normalizedWallet.slice(0, 10)}... checking Supabase`,
      );

      let profile = null;

      try {
        const um = getLocalUserManager();
        profile = await um.getUserProfile(normalizedWallet);
      } catch (dbErr) {
        console.warn(
          "[CHECK-USER] Database lookup failed:",
          dbErr,
        );
      }

      if (profile) {
        const isOnboarded = !!profile.email;
        console.log(
          `[CHECK-USER] ${normalizedWallet.slice(0, 10)}... found in Supabase`,
        );
        res.json({ exists: true, is_onboarded: isOnboarded, user: profile });
        return;
      }

      console.log(
        `[CHECK-USER] ${normalizedWallet.slice(0, 10)}... not in Supabase, checking on-chain (legacy fallback)`,
      );

      try {
        const onChain = await hasClaimedOnChain(normalizedWallet);
        if (onChain) {
          console.log(
            `[CHECK-USER] ${normalizedWallet.slice(0, 10)}... found on-chain (legacy user)`,
          );

          res.json({
            exists: true,
            is_onboarded: true,
            user: null,
            legacy: true,
          });
          return;
        }
      } catch (chainErr) {
        console.warn("[CHECK-USER] On-chain fallback also failed:", chainErr);
      }

      console.log(
        `[CHECK-USER] ${normalizedWallet.slice(0, 10)}... not found anywhere`,
      );
      res.json({ exists: false, is_onboarded: false, user: null });
    } catch (error) {
      console.error("Error in check-user:", error);
      next(error);
    }
  },
);

router.get(
  "/check-waitlist",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { email } = req.query;

      if (!email || typeof email !== "string") {
        res
          .status(400)
          .json({ error: "Bad Request", detail: "Email is required" });
        return;
      }

      const isWaitlisted = await isEmailOnWaitlist(email);
      res.json({ on_waitlist: isWaitlisted });
    } catch (error) {
      console.error("Error in check-waitlist:", error);
      next(error);
    }
  },
);

router.get(
  "/check-claim-status",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { wallet_address, tx_digest } = req.query;

      if (!wallet_address || typeof wallet_address !== "string") {
        res
          .status(400)
          .json({ error: "Bad Request", detail: "Wallet address is required" });
        return;
      }

      const minter = getLocalTicketMinter();

      if (tx_digest && typeof tx_digest === "string") {
        const verification = await minter.verifyClaimByDigest(tx_digest);
        if (verification?.confirmed) {
          res.json({
            claimed: true,
            balance: verification.balance,
            wallet_address,
          });
          return;
        }
      }

      const claimed = await hasClaimedOnChain(wallet_address);
      const balance = await minter.getBalance(wallet_address);
      res.json({ claimed, balance, wallet_address });
    } catch (error) {
      console.error("Error in check-claim-status:", error);
      next(error);
    }
  },
);

/**
 * GET /api/auth/verify
 * Lightweight check to resume a session without signing a new message.
 * Verifies the httpOnly cookie and returns the user's profile if authenticated.
 */
router.get("/verify", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const normalizedAddr = normalizeAddr(req.user!.wallet_address);
    const um = getLocalUserManager();
    const profile = await um.getUserProfile(normalizedAddr);
    res.json({ exists: true, is_onboarded: !!profile?.email, user: profile || { wallet_address: normalizedAddr } });
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
    const { wallet_address, signature, device_name, referral_code } = req.body;
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

    const expectedMessage = `Welcome to Tovira!\n\nClick to sign in and accept the Tovira Terms of Service.\n\nThis request will not trigger a blockchain transaction or cost any gas fees.\n\nNonce: ${storedData.nonce}`;
    const message = new TextEncoder().encode(expectedMessage);

    console.log(`[AUTH] Verifying signature for ${normalizedWallet}...`);
    
    // Verify signature
    const pubKey = await verifyPersonalMessageSignature(message, signature, {
      client: suiClient,
    });

    const derivedAddress = normalizeAddr(pubKey.toSuiAddress());
    
    if (derivedAddress !== normalizedWallet) {
      console.warn(`[AUTH] Address mismatch: Derived ${derivedAddress} vs Provided ${normalizedWallet}`);
      res.status(401).json({ error: "Signature mapped to different address", detail: `Expected ${normalizedWallet}, got ${derivedAddress}` });
      return;
    }

    console.log(`[AUTH] Signature verified successfully for ${normalizedWallet}`);
    nonceStore.delete(normalizedWallet);

    // Ensure user profile exists in DB before creating a token (satisfies foreign key constraint)
    let dbWallet = normalizedWallet;
    try {
      const { data: existing } = await supabase
        .from('user_profiles')
        .select('wallet_address')
        .ilike('wallet_address', normalizedWallet)
        .maybeSingle();

      if (!existing) {
        console.log(`[AUTH] New user detected, creating profile for ${normalizedWallet}`);
        const um = getLocalUserManager();
        const profile = um.createUserProfile("", normalizedWallet, false, 0);
        
        const referralService = getReferralService();
        try {
          profile.referral_code = await referralService.generateUniqueReferralCode();
        } catch (e) {}

        await um.addOrUpdateUser(profile);

        // Referral processing is handled exclusively in the /register route.
      } else {
        // Use the casing already present in the database to satisfy FK constraints
        dbWallet = existing.wallet_address;
        if (dbWallet !== normalizedWallet) {
          console.log(`[AUTH] Using legacy casing from DB: ${dbWallet}`);
        }
      }
    } catch (err) {
      console.error("[AUTH] Error ensuring user profile exists:", err);
      // Proceed anyway, createToken will fail if it's really missing
    }

    // Issue a secure server-side token (HMAC-SHA256 stored in DB)
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
 * Deletes the current token row from the DB and clears the cookie.
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
 * Deletes ALL token rows for the authenticated user, invalidating every device.
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
