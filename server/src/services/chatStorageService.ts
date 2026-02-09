// server/src/services/chatStorageService.ts
import axios from "axios";
import { getEncryptionService, type EncryptedData } from "./encryptionService";
import { TicketMinter } from "./ticketMinter";
import { WalrusUserManager } from "./walrusUserManager";

export interface ChatMessage {
  id: string;
  text: string;
  sender: "user" | "ai";
  timestamp: string;
  agentType?: string;
  agentId?: string;
}

export interface ChatMetadata {
  chat_id: string;
  name: string;
  created_at: string;
  last_updated: string;
  message_count: number;
  agent_id?: string;
}

export interface ChatRegistry {
  version: number;
  user_id: string;
  updated_at: string;
  chats: Record<
    string,
    {
      metadata: EncryptedData;
      messages_blob_id?: string; // Points to the messages blob for this chat
    }
  >;
  active_chat_ids: string[];
}

export interface ChatData {
  chat_id: string;
  user_id: string;
  messages: EncryptedData[]; // Encrypted messages
  created_at: string;
  updated_at: string;
}

export interface WalrusUploadResponse {
  newlyCreated?: {
    blobObject: {
      blobId: string;
    };
  };
  alreadyCertified?: {
    blobId: string;
  };
}

export class ChatStorageService {
  private publisherUrl: string;
  private aggregatorUrl: string;
  private epochs: number;
  private encryption = getEncryptionService();
  private registryCache: Map<
    string,
    { blobId: string; registry: ChatRegistry }
  > = new Map();
  private chatDataCache: Map<string, { blobId: string; data: ChatData }> =
    new Map();

  constructor() {
    this.publisherUrl =
      process.env.WALRUS_PUBLISHER_URL ||
      "https://publisher.walrus-testnet.walrus.space";
    this.aggregatorUrl =
      process.env.WALRUS_AGGREGATOR_URL ||
      "https://aggregator.walrus-testnet.walrus.space";
    this.epochs = parseInt(process.env.WALRUS_EPOCHS || "50", 10);

    console.log("✅ ChatStorageService initialized");
  }

  // Get user's chat registry blob ID from their profile
  private async getUserChatRegistryBlobId(
    userId: string,
  ): Promise<string | null> {
    try {
      const ticketMinter = new TicketMinter();
      const userRegistryBlobId = await ticketMinter.getCurrentBlobId();

      if (!userRegistryBlobId) {
        console.log(`No user registry exists yet`);
        return null;
      }

      const userManager = new WalrusUserManager();
      const userProfile = await userManager.getUserProfile(
        userRegistryBlobId,
        userId,
      );

      if (!userProfile) {
        console.log(`User profile not found for ${userId}`);
        return null;
      }

      return userProfile.chat_registry_blob_id || null;
    } catch (error) {
      console.error("Error getting user chat registry blob ID:", error);
      return null;
    }
  }

  // Update user's profile with new chat registry blob ID
  private async updateUserChatRegistryBlobId(
    userId: string,
    chatRegistryBlobId: string,
  ): Promise<boolean> {
    try {
      const ticketMinter = new TicketMinter();
      const userRegistryBlobId = await ticketMinter.getCurrentBlobId();

      if (!userRegistryBlobId) {
        console.error("Cannot update: user registry doesn't exist");
        return false;
      }

      const userManager = new WalrusUserManager();
      const userProfile = await userManager.getUserProfile(
        userRegistryBlobId,
        userId,
      );

      if (!userProfile) {
        console.error(`Cannot update: user profile not found for ${userId}`);
        return false;
      }

      // Update profile with new chat registry blob ID
      const updatedProfile = userManager.createUserProfile(
        userProfile.email,
        userProfile.wallet_address,
        userProfile.is_waitlisted,
        userProfile.points_awarded,
        {
          username: userProfile.username,
          first_name: userProfile.first_name,
          last_name: userProfile.last_name,
          preferences: userProfile.preferences,
          waitlist_verified_at: userProfile.waitlist_verified_at,
          chat_registry_blob_id: chatRegistryBlobId,
          tasks_created_today: userProfile.tasks_created_today,
          tasks_claimed_today: userProfile.tasks_claimed_today,
          last_task_reset_date: userProfile.last_task_reset_date,
          subscription_tier: userProfile.subscription_tier,
          subscription_expires_at: userProfile.subscription_expires_at,
        },
      );

      const newUserRegistryBlobId = await userManager.addOrUpdateUser(
        userRegistryBlobId,
        updatedProfile,
      );

      if (!newUserRegistryBlobId) {
        console.error("Failed to update user profile");
        return false;
      }

      // Update on-chain registry if it changed
      if (newUserRegistryBlobId !== userRegistryBlobId) {
        await ticketMinter.updateBlobRegistry(newUserRegistryBlobId);
        console.log(
          `📦 Updated on-chain user registry: ${newUserRegistryBlobId}`,
        );
      }

      return true;
    } catch (error) {
      console.error("Error updating user chat registry blob ID:", error);
      return false;
    }
  }

  // Create new chat
  async createChat(
    userId: string,
    chatName: string,
    agentId?: string,
  ): Promise<{ chatId: string; registryBlobId: string }> {
    const chatId = `chat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date().toISOString();

    console.log(`\n🆕 Creating chat: ${chatId} for user: ${userId}`);

    // Create chat metadata
    const metadata: ChatMetadata = {
      chat_id: chatId,
      name: chatName,
      created_at: now,
      last_updated: now,
      message_count: 0,
      agent_id: agentId,
    };

    // Get user's current chat registry blob ID
    const currentRegistryBlobId = await this.getUserChatRegistryBlobId(userId);

    // Get existing registry or create new one
    let currentRegistry: ChatRegistry | null = null;
    if (currentRegistryBlobId) {
      currentRegistry = await this.getChatRegistry(userId);
    }

    // Encrypt metadata
    const encryptedMetadata = this.encryption.encrypt(JSON.stringify(metadata));

    // Create initial empty chat data
    const initialChatData: ChatData = {
      chat_id: chatId,
      user_id: userId,
      messages: [],
      created_at: now,
      updated_at: now,
    };

    // Upload initial chat data
    const chatDataBlobId = await this.uploadChatData(initialChatData);
    if (!chatDataBlobId) {
      throw new Error("Failed to upload initial chat data");
    }

    console.log(`📝 Chat data blob created: ${chatDataBlobId}`);

    // Update registry
    const updatedRegistry: ChatRegistry = currentRegistry
      ? {
          ...currentRegistry,
          version: currentRegistry.version + 1,
          updated_at: now,
          chats: {
            ...currentRegistry.chats,
            [chatId]: {
              metadata: encryptedMetadata,
              messages_blob_id: chatDataBlobId,
            },
          },
          active_chat_ids: [...currentRegistry.active_chat_ids, chatId],
        }
      : {
          version: 1,
          user_id: userId,
          updated_at: now,
          chats: {
            [chatId]: {
              metadata: encryptedMetadata,
              messages_blob_id: chatDataBlobId,
            },
          },
          active_chat_ids: [chatId],
        };

    // Upload registry
    const registryBlobId = await this.uploadRegistry(updatedRegistry);

    if (!registryBlobId) {
      throw new Error("Failed to upload chat registry");
    }

    // Cache the registry
    this.registryCache.set(userId, {
      blobId: registryBlobId,
      registry: updatedRegistry,
    });

    // Update user profile with new registry blob ID
    await this.updateUserChatRegistryBlobId(userId, registryBlobId);

    console.log(`✅ Chat created: ${chatId}`);
    console.log(`   Registry: ${registryBlobId}`);
    console.log(`   Messages: ${chatDataBlobId}`);

    return { chatId, registryBlobId };
  }

  // Add message to chat
  async addMessage(
    chatId: string,
    userId: string,
    message: ChatMessage,
  ): Promise<string> {
    console.log(`\n💬 Adding message to chat: ${chatId}`);

    // Get chat's messages blob ID from registry
    const registry = await this.getChatRegistry(userId);
    if (!registry || !registry.chats[chatId]) {
      throw new Error(`Chat ${chatId} not found in registry`);
    }

    const messagesBlobId = registry.chats[chatId].messages_blob_id;
    if (!messagesBlobId) {
      throw new Error(`No messages blob ID for chat ${chatId}`);
    }

    // Get existing chat data
    const chatData = await this.getChatDataByBlobId(messagesBlobId);
    if (!chatData) {
      throw new Error(`Chat data not found for blob ${messagesBlobId}`);
    }

    const now = new Date().toISOString();

    // Encrypt new message
    const encryptedMessage = this.encryption.encrypt(JSON.stringify(message));

    // Create updated chat data
    const updatedChatData: ChatData = {
      ...chatData,
      messages: [...chatData.messages, encryptedMessage],
      updated_at: now,
    };

    // Upload updated chat data
    const newChatBlobId = await this.uploadChatData(updatedChatData);

    if (!newChatBlobId) {
      throw new Error("Failed to upload chat data");
    }

    // Update registry with new messages blob ID
    await this.updateChatMetadata(
      userId,
      chatId,
      {
        last_updated: now,
        message_count: updatedChatData.messages.length,
      },
      newChatBlobId,
    );

    console.log(`✅ Message added to chat: ${chatId}`);
    console.log(`   New messages blob: ${newChatBlobId}`);

    return newChatBlobId;
  }

  // Get chat registry for user
  async getChatRegistry(userId: string): Promise<ChatRegistry | null> {
    // Check cache first
    const cached = this.registryCache.get(userId);
    if (cached) {
      console.log(`📋 Using cached registry for ${userId}`);
      return cached.registry;
    }

    // Get user's chat registry blob ID from their profile
    const registryBlobId = await this.getUserChatRegistryBlobId(userId);
    if (!registryBlobId) {
      console.log(`No chat registry exists for user ${userId}`);
      return null;
    }

    try {
      console.log(`📥 Fetching chat registry: ${registryBlobId}`);
      const response = await axios.get(
        `${this.aggregatorUrl}/v1/blobs/${registryBlobId}`,
        { timeout: 30000 },
      );

      const registry = response.data as ChatRegistry;

      // Cache it
      this.registryCache.set(userId, {
        blobId: registryBlobId,
        registry,
      });

      console.log(
        `✅ Chat registry loaded: ${Object.keys(registry.chats).length} chats`,
      );
      return registry;
    } catch (error) {
      console.error(`Error fetching chat registry for ${userId}:`, error);
      return null;
    }
  }

  // Get chat data by blob ID
  async getChatDataByBlobId(blobId: string): Promise<ChatData | null> {
    // Check cache
    const cached = this.chatDataCache.get(blobId);
    if (cached) {
      return cached.data;
    }

    try {
      const response = await axios.get(
        `${this.aggregatorUrl}/v1/blobs/${blobId}`,
        { timeout: 30000 },
      );

      const chatData = response.data as ChatData;

      // Cache it
      this.chatDataCache.set(blobId, {
        blobId,
        data: chatData,
      });

      return chatData;
    } catch (error) {
      console.error(`Error fetching chat data for blob ${blobId}:`, error);
      return null;
    }
  }

  // Get decrypted messages for a chat
  async getMessages(chatId: string): Promise<ChatMessage[]> {
    console.log(`\n📖 Getting messages for chat: ${chatId}`);

    // Extract userId from chatId or we need to pass it
    // For now, we'll need to search through cached registries
    // Better: pass userId explicitly in the route

    // Find the chat in any cached registry
    for (const [userId, cached] of this.registryCache.entries()) {
      const chat = cached.registry.chats[chatId];
      if (chat && chat.messages_blob_id) {
        const chatData = await this.getChatDataByBlobId(chat.messages_blob_id);
        if (!chatData) return [];

        const messages = chatData.messages.map((encrypted) => {
          const decrypted = this.encryption.decrypt(encrypted);
          return JSON.parse(decrypted) as ChatMessage;
        });

        console.log(`✅ Loaded ${messages.length} messages`);
        return messages;
      }
    }

    console.log(`⚠️ Chat ${chatId} not found in cache`);
    return [];
  }

  // Get chat list for user
  async getChatList(userId: string): Promise<ChatMetadata[]> {
    console.log(`\n📋 Getting chat list for user: ${userId}`);

    const registry = await this.getChatRegistry(userId);
    if (!registry) {
      console.log(`No chats found for user ${userId}`);
      return [];
    }

    const chats = Object.values(registry.chats).map((chat) => {
      const decrypted = this.encryption.decrypt(chat.metadata);
      return JSON.parse(decrypted) as ChatMetadata;
    });

    // Sort by last_updated descending
    chats.sort(
      (a, b) =>
        new Date(b.last_updated).getTime() - new Date(a.last_updated).getTime(),
    );

    console.log(`✅ Found ${chats.length} chats`);
    return chats;
  }

  // Delete chat
  async deleteChat(userId: string, chatId: string): Promise<boolean> {
    console.log(`\n🗑️ Deleting chat: ${chatId}`);

    const registry = await this.getChatRegistry(userId);
    if (!registry) return false;

    const { [chatId]: removed, ...remainingChats } = registry.chats;

    if (!removed) {
      console.log(`Chat ${chatId} not found`);
      return false;
    }

    const updatedRegistry: ChatRegistry = {
      ...registry,
      version: registry.version + 1,
      updated_at: new Date().toISOString(),
      chats: remainingChats,
      active_chat_ids: registry.active_chat_ids.filter((id) => id !== chatId),
    };

    const registryBlobId = await this.uploadRegistry(updatedRegistry);

    if (!registryBlobId) return false;

    // Update cache
    this.registryCache.set(userId, {
      blobId: registryBlobId,
      registry: updatedRegistry,
    });

    // Update user profile
    await this.updateUserChatRegistryBlobId(userId, registryBlobId);

    console.log(`✅ Chat deleted: ${chatId}`);

    return true;
  }

  // Helper: Update chat metadata
  private async updateChatMetadata(
    userId: string,
    chatId: string,
    updates: Partial<ChatMetadata>,
    newMessagesBlobId?: string,
  ): Promise<void> {
    const registry = await this.getChatRegistry(userId);
    if (!registry || !registry.chats[chatId]) return;

    // Decrypt existing metadata
    const existingMetadata = JSON.parse(
      this.encryption.decrypt(registry.chats[chatId].metadata),
    ) as ChatMetadata;

    // Merge updates
    const updatedMetadata: ChatMetadata = {
      ...existingMetadata,
      ...updates,
    };

    // Re-encrypt
    const encryptedMetadata = this.encryption.encrypt(
      JSON.stringify(updatedMetadata),
    );

    // Update registry
    const updatedRegistry: ChatRegistry = {
      ...registry,
      version: registry.version + 1,
      updated_at: new Date().toISOString(),
      chats: {
        ...registry.chats,
        [chatId]: {
          metadata: encryptedMetadata,
          messages_blob_id:
            newMessagesBlobId || registry.chats[chatId].messages_blob_id,
        },
      },
    };

    const newRegistryBlobId = await this.uploadRegistry(updatedRegistry);

    if (newRegistryBlobId) {
      // Update cache
      this.registryCache.set(userId, {
        blobId: newRegistryBlobId,
        registry: updatedRegistry,
      });

      // Update user profile
      await this.updateUserChatRegistryBlobId(userId, newRegistryBlobId);
    }
  }

  // Helper: Upload registry
  private async uploadRegistry(registry: ChatRegistry): Promise<string | null> {
    try {
      const registryJson = JSON.stringify(registry);

      const response = await axios.put(
        `${this.publisherUrl}/v1/blobs`,
        registryJson,
        {
          headers: { "Content-Type": "application/json" },
          params: { epochs: this.epochs },
          timeout: 30000,
        },
      );

      const result = response.data as WalrusUploadResponse;
      return (
        result.newlyCreated?.blobObject?.blobId ||
        result.alreadyCertified?.blobId ||
        null
      );
    } catch (error) {
      console.error("Error uploading registry:", error);
      return null;
    }
  }

  // Helper: Upload chat data
  private async uploadChatData(chatData: ChatData): Promise<string | null> {
    try {
      const chatJson = JSON.stringify(chatData);

      const response = await axios.put(
        `${this.publisherUrl}/v1/blobs`,
        chatJson,
        {
          headers: { "Content-Type": "application/json" },
          params: { epochs: this.epochs },
          timeout: 30000,
        },
      );

      const result = response.data as WalrusUploadResponse;
      return (
        result.newlyCreated?.blobObject?.blobId ||
        result.alreadyCertified?.blobId ||
        null
      );
    } catch (error) {
      console.error("Error uploading chat data:", error);
      return null;
    }
  }
}

// Singleton
let chatStorageService: ChatStorageService | null = null;

export function getChatStorageService(): ChatStorageService {
  if (!chatStorageService) {
    chatStorageService = new ChatStorageService();
  }
  return chatStorageService;
}
