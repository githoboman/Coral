import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

// Use a secure environment variable in production
export const JWT_SECRET = process.env.JWT_SECRET || "default_dev_secret_key_please_change";

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

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { wallet_address: string };
    
    req.user = { wallet_address: decoded.wallet_address };
    
    // Security verification for backward compatibility
    // Ensure that if a user_id is provided in the request, it matches the authenticated session payload
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
