import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

const fastLlm = new ChatGoogleGenerativeAI({
  model: "gemini-2.5-flash",
  apiKey: process.env.GEMINI_API_KEY_TASK || process.env.GEMINI_API_KEY,
  temperature: 0,
  maxRetries: 1,
  maxOutputTokens: 2048,
});

interface NotificationCopy {
  task_context: string;
  reminder_time_context: string;
}

export class NotificationCopyService {
  private static instance: NotificationCopyService;

  private constructor() {}

  public static getInstance(): NotificationCopyService {
    if (!NotificationCopyService.instance) {
      NotificationCopyService.instance = new NotificationCopyService();
    }
    return NotificationCopyService.instance;
  }

  /**
   * Generates conversational copy for notifications using an LLM.
   * If the LLM fails or times out, falls back to raw data and formatting.
   */
  public async generateCopy(task: any, createdAt: string | Date = new Date()): Promise<NotificationCopy> {
    const startMs = Date.now();
    const taskName = task.task_name || "New Task";
    const description = task.description || "";
    const dueDate = task.due_date;

    let fallbackTime = "soon";
    if (dueDate) {
      const msDiff = new Date(dueDate).getTime() - Date.now();
      if (msDiff > 0) {
        const minutes = Math.round(msDiff / (1000 * 60));
        if (minutes < 60) {
          fallbackTime = `in ${minutes} minute${minutes !== 1 ? 's' : ''}`;
        } else {
          const hours = Math.round(minutes / 60);
          if (hours < 24) {
            fallbackTime = `in ${hours} hour${hours !== 1 ? 's' : ''}`;
          } else {
            fallbackTime = `in ${Math.round(hours / 24)} day${Math.round(hours / 24) !== 1 ? 's' : ''}`;
          }
        }
      } else {
        fallbackTime = "now";
      }
    }

    const fallback: NotificationCopy = {
      task_context: taskName.toLowerCase(),
      reminder_time_context: fallbackTime,
    };

    try {
      const prompt = `
Generate natural conversation copy for a task notification.

INPUT DATA:
- Task Name: "${taskName}"
- Description: "${description}"
- Created At: "${new Date(createdAt).toISOString()}"
- Due Date: "${dueDate ? new Date(dueDate).toISOString() : 'None'}"

RULES FOR task_context:
- It must flow grammatically when placed after "You just set a new Task to " or "Here to remind you to "
- It should be concise — one sentence maximum.
- Capture the intent, don't just repeat the raw text.
- If description adds meaningful context beyond the name, weave it in naturally. If redundant, ignore it.
- Example: Name "Call dentist", Desc "Book cleaning" -> "call your dentist and book that cleaning appointment"

RULES FOR reminder_time_context:
- Compute relative to the "Created At" time.
- Express naturally as a continuation of "You said to remind you "
- NEVER use raw timestamps or date formats.
- Example: "in 2 minutes", "tomorrow morning at 9", "in 6 days".

OUTPUT FORMAT:
Return a raw JSON object with EXACTLY two string properties: "task_context" and "reminder_time_context".
Do NOT include markdown formatting like \`\`\`json. Just output the JSON object.
`;

      // 5 second timeout for copy generation so notifications don't hang
      const response = await Promise.race([
        fastLlm.invoke([
          { role: "system", content: "You are a concise notification copywriter. Return ONLY a valid JSON object. No conversational preamble." },
          { role: "human", content: prompt }
        ]),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("LLM copy generation timeout")), 5000))
      ]);

      const text = typeof response.content === 'string' ? response.content : '';
      
      // Use regex to extract JSON object in case Gemini includes markdown or preamble
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.task_context && parsed.reminder_time_context) {
          console.log(`[NOTIFY COPY] ✅ Generated (${Date.now() - startMs}ms):`, parsed);
          return {
            task_context: parsed.task_context,
            reminder_time_context: parsed.reminder_time_context
          };
        }
      }
      
      throw new Error(`Invalid or missing JSON format from LLM: ${text}`);

    } catch (error) {
      console.warn(`[NOTIFY COPY] ⚠️ Copy generation failed, using fallback (${Date.now() - startMs}ms):`, error);
      return fallback;
    }
  }
}

export const getNotificationCopyService = () => NotificationCopyService.getInstance();
