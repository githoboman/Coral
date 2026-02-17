import { getChatService } from "../src/services/chatService";
import dotenv from "dotenv";
import path from "path";

// Explicitly load .env from server root
const envPath = path.join(process.cwd(), ".env");
console.log("Loading .env from:", envPath);
dotenv.config({ path: envPath });

async function testChatService() {
  console.log("Testing ChatService...");

  try {
    const chatService = getChatService();
    console.log("Service initialized.");

    // Test getChats
    console.log("Calling getChats('test-user')...");
    const chats = await chatService.getChats("test-user");
    console.log("getChats result:", chats);

    // Test createChat
    console.log("Calling createChat...");
    const newChat = await chatService.createChat("test-user", "task", "Test Chat");
    console.log("createChat result:", newChat);

    if (newChat) {
      // Test addMessage
      console.log("Calling addMessage...");
      const msg = await chatService.addMessage(newChat.chat_id, "test-user", "user", "Hello world");
      console.log("addMessage result:", msg);

      // Test getChatHistory
      console.log("Calling getChatHistory...");
      const history = await chatService.getChatHistory(newChat.chat_id);
      console.log("getChatHistory result:", history);

      // Clean up
      console.log("Cleaning up...");
      await chatService.deleteChat(newChat.chat_id);
      console.log("Deleted chat.");
    }

  } catch (err) {
    console.error("Test Failed:", err);
  }
}

testChatService();
