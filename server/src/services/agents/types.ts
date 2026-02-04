import { BaseMessage } from "@langchain/core/messages";

export interface AgentState {
  messages: BaseMessage[];
  userQuery: string;
  userId: string;
  walletAddress?: string;
  walletBalance?: {
    totalBalanceMist: string;
    totalBalanceSui: string;
  };
  chatId?: string;
  intent?: string;
  targetAgent?: string;
  requiresFee?: boolean;
  estimatedCost?: number;
  transactionHash?: string; // Gas payment transaction hash
  gasPaid?: boolean; // Flag to indicate if gas was paid
  workflowSteps?: WorkflowStep[];
  finalResponse?: string;
  error?: string;
  // For immediate task execution
  pendingAction?: {
    taskId: number;
    actionType: string;
    actionParams: any;
  };
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
  transaction_hash?: string; // Gas payment transaction hash
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
  points_awarded?: number;
  // For immediate task execution - frontend should trigger signing
  pending_action?: {
    task_id: number;
    action_type: string;
    action_params: any;
  };
}

// Task Action Types for Web3 Automation
export enum TaskActionType {
  REMINDER = 'reminder',
  TOKEN_TRANSFER = 'token_transfer',
  DCA_PURCHASE = 'dca_purchase',
}

export interface TokenTransferParams {
  recipientAddress: string;
  coinType: string;       // e.g., "0x2::sui::SUI"
  amount: string;         // In base units (MIST for SUI)
}

export interface DCAParams {
  fromCoin: string;       // e.g., "0x2::sui::SUI"
  toCoin: string;         // e.g., "0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN" (USDC)
  amountPerPurchase: string;
  frequency: 'daily' | 'weekly' | 'monthly';
  nextExecutionDate?: string;
}

export type TaskActionParams = TokenTransferParams | DCAParams;

export interface TaskAction {
  type: TaskActionType;
  params: TaskActionParams;
  status: 'pending' | 'ready' | 'awaiting_signature' | 'executing' | 'completed' | 'failed';
  txDigest?: string;
  error?: string;
  lastExecutedAt?: string;
}
