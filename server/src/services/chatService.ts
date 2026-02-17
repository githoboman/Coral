import { getSupabaseClient } from "../config/supabase";

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
    const { data, error } = await this.supabase
      .from("chats")
      .insert({
        user_id: userId,
        agent_id: agentId,
        name: name,
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating chat:", error);
      return null;
    }

    return data;
  }

  // Add a message to a chat
  async addMessage(
    chatId: string,
    userId: string | null,
    sender: "user" | "ai",
    content: string
  ): Promise<ChatMessage | null> {
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

    if (error) {
      console.error("Error adding message:", error);
      return null;
    }

    // Update last_updated timestamp on chat
    await this.supabase
      .from("chats")
      .update({ last_updated: new Date().toISOString() })
      .eq("chat_id", chatId);

    return data;
  }

  // Get all chats for a user
  async getChats(userId: string): Promise<Chat[]> {
    const { data, error } = await this.supabase
      .from("chats")
      .select("*")
      .eq("user_id", userId)
      .order("last_updated", { ascending: false });

    if (error) {
      console.error("Error fetching chats:", error);
      return [];
    }

    return data;
  }

  // Get messages for a chat
  async getChatHistory(chatId: string): Promise<ChatMessage[]> {
    const { data, error } = await this.supabase
      .from("chat_messages")
      .select("*")
      .eq("chat_id", chatId)
      .order("timestamp", { ascending: true });

    if (error) {
      console.error("Error fetching chat history:", error);
      return [];
    }

    return data;
  }

  // Delete a chat (and cascade messages if configured, or manually)
  async deleteChat(chatId: string): Promise<boolean> {
    // Delete messages first (if no cascade) - forcing it just in case
    const { error: msgError } = await this.supabase
      .from("chat_messages")
      .delete()
      .eq("chat_id", chatId);

    if (msgError) {
      console.error("Error deleting chat messages:", msgError);
    }

    const { error } = await this.supabase
      .from("chats")
      .delete()
      .eq("chat_id", chatId);

    if (error) {
      console.error("Error deleting chat:", error);
      return false;
    }

    return true;
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
