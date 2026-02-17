import { getSupabaseClient } from "../config/supabase";
import { withRetry } from "../utils/retryUtils";

export interface Chat {
  chat_id: string;
  user_id: string;
  name: string;
  created_at: string;
  last_updated: string;
  agent_id: string;
}

export interface ChatMessage {
  id: string;
  chat_id: string;
  query: string; // Content
  user_id: string | null;
  sender: "user" | "ai";
  timestamp: string;
}

export class ChatService {
  private get supabase() {
    return getSupabaseClient();
  }

  // Create a new chat
  async createChat(userId: string, agentId: string, name: string = "New conversation"): Promise<Chat | null> {
    try {
      return await withRetry(async () => {
        const { data, error } = await this.supabase
          .from("chats")
          .insert({
            user_id: userId,
            agent_id: agentId,
            name: name,
          })
          .select()
          .single();

        if (error) throw error;
        return data;
      }, 3, 1000, "ChatService.createChat");
    } catch (error) {
      console.error("Error creating chat:", error);
      return null;
    }
  }

  // Add a message to a chat
  async addMessage(
    chatId: string,
    userId: string | null,
    sender: "user" | "ai",
    content: string
  ): Promise<ChatMessage | null> {
    try {
      const data = await withRetry(async () => {
        const { data, error } = await this.supabase
          .from("chat_messages")
          .insert({
            chat_id: chatId,
            user_id: userId,
            sender: sender,
            query: content,
          })
          .select()
          .single();

        if (error) throw error;
        return data;
      }, 3, 1000, "ChatService.addMessage");

      // Update last_updated timestamp on chat (fire and forget with retry?)
      // Actually let's await it to ensure consistency, but if it fails it's non-critical?
      // Better to await and retry.
      await withRetry(async () => {
        const { error } = await this.supabase
          .from("chats")
          .update({ last_updated: new Date().toISOString() })
          .eq("chat_id", chatId);
        if (error) throw error;
      }, 3, 1000, "ChatService.updateTimestamp");

      return data;
    } catch (error) {
      console.error("Error adding message:", error);
      return null;
    }
  }

  // Get all chats for a user
  async getChats(userId: string): Promise<Chat[]> {
    try {
      return await withRetry(async () => {
        const { data, error } = await this.supabase
          .from("chats")
          .select("*")
          .eq("user_id", userId)
          .order("last_updated", { ascending: false });

        if (error) throw error;
        return data || [];
      }, 3, 1000, "ChatService.getChats");
    } catch (error) {
      console.error("Error fetching chats:", error);
      return [];
    }
  }

  // Get messages for a chat
  async getChatHistory(chatId: string): Promise<ChatMessage[]> {
    try {
      return await withRetry(async () => {
        const { data, error } = await this.supabase
          .from("chat_messages")
          .select("*")
          .eq("chat_id", chatId)
          .order("timestamp", { ascending: true });

        if (error) throw error;
        return data || [];
      }, 3, 1000, "ChatService.getChatHistory");
    } catch (error) {
      console.error("Error fetching chat history:", error);
      return [];
    }
  }

  // Delete a chat (and cascade messages if configured, or manually)
  async deleteChat(chatId: string): Promise<boolean> {
    try {
      // Delete messages first
      await withRetry(async () => {
        const { error } = await this.supabase
          .from("chat_messages")
          .delete()
          .eq("chat_id", chatId);
        if (error) throw error;
      }, 3, 1000, "ChatService.deleteMessages");

      // Delete chat
      await withRetry(async () => {
        const { error } = await this.supabase
          .from("chats")
          .delete()
          .eq("chat_id", chatId);
        if (error) throw error;
      }, 3, 1000, "ChatService.deleteChat");

      return true;
    } catch (error) {
      console.error("Error deleting chat:", error);
      return false;
    }
  }
}

// Singleton helper
let chatService: ChatService | null = null;
export const getChatService = () => {
  if (!chatService) {
    chatService = new ChatService();
  }
  return chatService;
};
