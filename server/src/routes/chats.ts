import { Router, Request, Response } from "express";
import { getChatService } from "../services/chatService";
import { requireAuth, AuthRequest } from "../middleware/auth";

const router = Router();
const chatService = getChatService();

// GET /api/chats - List user's own chats only
router.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.wallet_address;

  try {
    const chats = await chatService.getChats(userId);
    res.json(chats);
  } catch (error) {
    console.error("Error fetching chats:", error);
    res.status(500).json({ error: "Failed to fetch chats" });
  }
});

// GET /api/chats/:chatId - Get chat history (ownership verified)
router.get("/:chatId", requireAuth, async (req: AuthRequest, res: Response) => {
  const { chatId } = req.params;
  const userId = req.user!.wallet_address;

  if (!chatId) {
    res.status(400).json({ error: "chatId is required" });
    return;
  }

  try {
    // Verify ownership: check if this chat belongs to the authenticated user
    const userChats = await chatService.getChats(userId);
    const ownsChat = userChats.some(c => c.chat_id === chatId);

    if (!ownsChat) {
      res.status(403).json({ error: "Forbidden", detail: "You do not own this chat" });
      return;
    }

    const messages = await chatService.getChatHistory(chatId);
    res.json(messages);
  } catch (error) {
    console.error("Error fetching chat history:", error);
    res.status(500).json({ error: "Failed to fetch chat history" });
  }
});

// DELETE /api/chats/:chatId - Delete a chat (ownership verified)
router.delete("/:chatId", requireAuth, async (req: AuthRequest, res: Response) => {
  const { chatId } = req.params;
  const userId = req.user!.wallet_address;

  if (!chatId) {
    res.status(400).json({ error: "chatId is required" });
    return;
  }

  try {
    // Verify ownership: check if this chat belongs to the authenticated user
    const userChats = await chatService.getChats(userId);
    const ownsChat = userChats.some(c => c.chat_id === chatId);

    if (!ownsChat) {
      res.status(403).json({ error: "Forbidden", detail: "You do not own this chat" });
      return;
    }

    const success = await chatService.deleteChat(chatId);
    if (success) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "Chat not found or failed to delete" });
    }
  } catch (error) {
    console.error("Error deleting chat:", error);
    res.status(500).json({ error: "Failed to delete chat" });
  }
});

export default router;
