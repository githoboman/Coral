import { Request, Response, NextFunction } from "express";

export async function validateUser(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const user_id = req.body.user_id || req.query.user_id || req.params.user_id;

  if (!user_id) {
    res.status(401).json({
      error: "Unauthorized",
      detail: "user_id is required",
    });
    return;
  }

  if (
    typeof user_id !== "string" ||
    !user_id.startsWith("0x") ||
    user_id.length !== 66 ||
    !/^0x[a-fA-F0-9]{64}$/.test(user_id)
  ) {
    res.status(400).json({
      error: "Bad Request",
      detail:
        "Invalid wallet address format. Must be a valid Sui address (0x + 64 hex chars)",
    });
    return;
  }

  next();
}

export function extractUserId(req: Request): string | null {
  return (req.body.user_id ||
    req.query.user_id ||
    req.params.user_id ||
    req.params.userId ||
    null) as string | null;
}
