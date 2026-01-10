import { StateGraph, END, START } from "@langchain/langgraph";
import { AgentState, AgentType } from "./types";
import { routerNode } from "./nodes/routerNode";
import { researchNode } from "./nodes/researchNode";
import { taskNode } from "./nodes/taskNode";
import { alertNode } from "./nodes/alertNode";
import { mainNode } from "./nodes/mainNode";

// Define the graph
const workflow = new StateGraph<AgentState>({
  channels: {
    messages: {
      value: (x, y) => (y ? x.concat(y) : x),
      default: () => [],
    },
    userQuery: {
      value: (x, y) => y ?? x,
      default: () => "",
    },
    userId: {
      value: (x, y) => y ?? x,
      default: () => "",
    },
    chatId: {
      value: (x, y) => y ?? x,
    },
    intent: {
      value: (x, y) => y ?? x,
    },
    targetAgent: {
      value: (x, y) => y ?? x,
    },
    requiresFee: {
      value: (x, y) => y ?? x,
      default: () => false,
    },
    estimatedCost: {
      value: (x, y) => y ?? x,
      default: () => 0,
    },
    transactionHash: {
      value: (x, y) => y ?? x,
    },
    gasPaid: {
      value: (x, y) => y ?? x,
      default: () => false,
    },
    workflowSteps: {
      value: (x, y) => y ?? x,
      default: () => [],
    },
    finalResponse: {
      value: (x, y) => y ?? x,
    },
    error: {
      value: (x, y) => y ?? x,
    },
  },
});

// Add nodes
workflow.addNode("router", routerNode);
workflow.addNode("research", researchNode);
workflow.addNode("task", taskNode);
workflow.addNode("alert", alertNode);
workflow.addNode("main", mainNode);

// Set entry point - route from START to router
workflow.addEdge(START, "router" as any);

// Add conditional edges from router to specialized agents
workflow.addConditionalEdges(
  "router" as any,
  (state: AgentState) => {
    // Route based on targetAgent
    return state.targetAgent || AgentType.MAIN;
  },
  {
    [AgentType.RESEARCH]: "research" as any,
    [AgentType.TASK]: "task" as any,
    [AgentType.ALERT]: "alert" as any,
    [AgentType.MAIN]: "main" as any,
  }
);

// All agents end after execution
workflow.addEdge("research" as any, END);
workflow.addEdge("task" as any, END);
workflow.addEdge("alert" as any, END);
workflow.addEdge("main" as any, END);

// Compile the graph
export const agentGraph = workflow.compile();
