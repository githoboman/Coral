import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

// Use a secure environment variable in production
export const JWT_SECRET = process.env.JWT_SECRET || "default_dev_secret_key_please_change";

// In-memory token blacklist for sign-out invalidation.
// Note: This is cleared on server restart. For production, use Redis.
const tokenBlacklist = new Set<string>();

/**
 * Adds a token to the blacklist, preventing its future use.
 * Call this when a user signs out.
 */
export const blacklistToken = (token: string): void => {
  tokenBlacklist.add(token);
};

export interface AuthRequest extends Request {
  user?: {
    wallet_address: string;
  };
}

export const requireAuth = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({
      error: "Unauthorized",
      detail: "Missing or invalid Authorization header",
    });
    return;
  }

  const token = authHeader.split(" ")[1];

  // Check if this token has been blacklisted (user signed out)
  if (tokenBlacklist.has(token)) {
    res.status(401).json({
      error: "Unauthorized",
      detail: "Token has been revoked. Please sign in again.",
    });
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { wallet_address: string };
    
    req.user = { wallet_address: decoded.wallet_address };
    
    // Security verification: ensure that if a user_id is provided in the request,
    // it matches the authenticated session payload to prevent cross-user attacks.
    const requestedUserId = req.query.user_id || req.body.user_id || req.params.user_id;
    if (requestedUserId && requestedUserId !== decoded.wallet_address) {
       res.status(403).json({
         error: "Forbidden",
         detail: "Cannot access or modify other users' data",
       });
       return;
    }
    
    next();
  } catch (error) {
    res.status(401).json({
      error: "Unauthorized",
      detail: "Invalid or expired token",
    });
    return;
  }
};
