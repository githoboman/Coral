import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { AgentState, IntentType, AgentType, RouterResponse } from "../types";
import { z } from "zod";

const RouterSchema = z.object({
  intent: z.enum(['research', 'task', 'alert', 'chat', 'unknown']),
  target_agent: z.enum(['research_agent', 'task_agent', 'alert_agent', 'main']),
  requires_fee: z.boolean(),
  estimated_cost: z.number(),
  reason: z.string(),
});

export async function routerNode(state: AgentState): Promise<Partial<AgentState>> {
  const llm = new ChatGoogleGenerativeAI({
    model: process.env.LLM_MODEL || "gemini-2.5-flash",
    apiKey: process.env.GEMINI_API_KEY,
    temperature: 0,
  });

  const systemPrompt = `You are Tovira's Router Agent. Classify user requests and determine which specialized agent should handle them.

AGENTS & FEES:
- Research Agent (0.0008 SUI): Deep crypto analysis, token research, market reports, comprehensive insights
- Task Agent (FREE): Task automation, reminders, swaps, limit orders, on-chain actions
- Alert Agent (FREE): Price alerts, wallet monitoring, notifications, tracking
- Main Agent (FREE): General chat, questions, explanations, unclear requests

CLASSIFICATION RULES:
1. Research: Requires deep analysis, data gathering, or comprehensive reports
2. Task: User wants to automate something, create tasks, or execute actions
3. Alert: User wants to be notified about price changes or wallet activity
4. Chat: General questions, explanations, or unclear intent

User Query: "${state.userQuery}"

Return ONLY valid JSON matching this schema:
{
  "intent": "research" | "task" | "alert" | "chat",
  "target_agent": "research_agent" | "task_agent" | "alert_agent" | "main",
  "requires_fee": boolean,
  "estimated_cost": number (in SUI),
  "reason": "brief explanation of classification"
}`;

  try {
    const response = await llm.invoke(systemPrompt);
    const content = response.content as string;

    // Extract JSON from response (handle markdown code blocks)
    let jsonStr = content.trim();
    if (jsonStr.startsWith('```json')) {
      jsonStr = jsonStr.slice(7);
    } else if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.slice(3);
    }
    if (jsonStr.endsWith('```')) {
      jsonStr = jsonStr.slice(0, -3);
    }
    jsonStr = jsonStr.trim();

    const parsed = JSON.parse(jsonStr);
    const validated = RouterSchema.parse(parsed);

    return {
      intent: validated.intent as IntentType,
      targetAgent: validated.target_agent as AgentType,
      requiresFee: validated.requires_fee,
      estimatedCost: validated.estimated_cost,
    };
  } catch (error) {
    console.error('Router node error:', error);
    // Fallback to main agent
    return {
      intent: IntentType.CHAT,
      targetAgent: AgentType.MAIN,
      requiresFee: false,
      estimatedCost: 0,
    };
  }
}
