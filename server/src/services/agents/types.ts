import { BaseMessage } from "@langchain/core/messages";

export interface AgentState {
  messages: BaseMessage[];
  userQuery: string;
  userId: string;
  chatId?: string;
  intent?: string;
  targetAgent?: string;
  requiresFee?: boolean;
  estimatedCost?: number;
  workflowSteps?: WorkflowStep[];
  finalResponse?: string;
  error?: string;
}

export interface WorkflowStep {
  step: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  message: string;
}

export enum AgentType {
  RESEARCH = 'research_agent',
  TASK = 'task_agent',
  ALERT = 'alert_agent',
  MAIN = 'main',
}

export enum IntentType {
  RESEARCH = 'research',
  TASK = 'task',
  ALERT = 'alert',
  CHAT = 'chat',
  UNKNOWN = 'unknown',
}

export interface RouterResponse {
  intent: IntentType;
  targetAgent: AgentType;
  requiresFee: boolean;
  estimatedCost: number;
  reason: string;
}

export interface ChatRequest {
  user_id: string;
  message: string;
  agent_id?: string;
  chat_id?: string;
  history?: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
}

export interface ChatResponse {
  response: string;
  agent_used: string;
  chat_id: string;
  requires_fee?: boolean;
  estimated_cost?: number;
  workflow_steps?: WorkflowStep[];
}
