import { Router, Request, Response } from "express";
import { getChatService } from "../services/chatService";

const router = Router();
const chatService = getChatService();

// GET /api/chats - List user's chats
router.get("/", async (req: Request, res: Response) => {
  let userId = req.query.userId as string;
  if (userId) userId = userId.toLowerCase();

  if (!userId) {
    res.status(400).json({ error: "userId is required" });
    return;
  }

  try {
    const chats = await chatService.getChats(userId);
    res.json(chats);
  } catch (error) {
    console.error("Error fetching chats:", error);
    res.status(500).json({ error: "Failed to fetch chats" });
  }
});

// GET /api/chats/:chatId - Get chat history
router.get("/:chatId", async (req: Request, res: Response) => {
  const { chatId } = req.params;

  if (!chatId) {
    res.status(400).json({ error: "chatId is required" });
    return;
  }

  try {
    const messages = await chatService.getChatHistory(chatId);
    res.json(messages);
  } catch (error) {
    console.error("Error fetching chat history:", error);
    res.status(500).json({ error: "Failed to fetch chat history" });
  }
});

// DELETE /api/chats/:chatId - Delete a chat
router.delete("/:chatId", async (req: Request, res: Response) => {
  const { chatId } = req.params;

  if (!chatId) {
    res.status(400).json({ error: "chatId is required" });
    return;
  }

  try {
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
