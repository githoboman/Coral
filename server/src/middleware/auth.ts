import { Request, Response, NextFunction } from 'express';
import { validateToken } from '../services/tokenService';

export interface AuthRequest extends Request {
  user?: {
    wallet_address: string;
  };
}

export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const rawToken = req.cookies?.auth_token;

  if (!rawToken) {
    res.status(401).json({
      error: 'Unauthorized',
      detail: 'No auth token cookie present. Please sign in.',
    });
    return;
  }

  const userId = await validateToken(rawToken);

  if (!userId) {
    res.status(401).json({
      error: 'Unauthorized',
      detail: 'Invalid or expired token. Please sign in again.',
    });
    return;
  }

  req.user = { wallet_address: userId };

  // Cross-user guard: if the request explicitly specifies a user_id, it must match
  const requestedUserId =
    (req.query.user_id as string) || req.body?.user_id || req.params?.user_id;

  if (requestedUserId) {
    const requestedLower = requestedUserId.toLowerCase();
    const tokenLower = userId.toLowerCase();
    
    if (requestedLower !== tokenLower) {
      console.warn(`[AUTH] 403: requested=${requestedLower.slice(0,10)}… token=${tokenLower.slice(0,10)}…`);
      res.status(403).json({
        error: 'Forbidden',
        detail: "Cannot access or modify another user's data.",
      });
      return;
    }
  }

  next();
};
