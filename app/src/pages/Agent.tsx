import AgentControls from "@/components/agent/AgentControls";
import { ThemeToggle } from "@/components/ui/ThemeToggle";

/**
 * Agent page — hosts the Autonomous Agent Wallet control panel (Corral design).
 * Rendered inside AppLayout, reachable from the "Agent" nav item.
 */
export default function Agent() {
  return (
    <div className="w-full min-h-dvh bg-[#FAF9F6] dark:bg-[#262626] px-4 py-6 md:px-8 md:py-10 transition-colors duration-200">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-start justify-between gap-4 mb-8">
          <div>
            <h1 className="text-[26px] font-bold text-zinc-900 dark:text-zinc-50 mb-1 leading-tight">
              Autonomous Agent
            </h1>
            <p className="text-[13px] text-[#5E5E5E] dark:text-zinc-400 max-w-[560px]">
              Delegate on-chain trading to an agent within policy limits you set once — enforced
              on-chain. Instruct it in plain language, and revoke any time.
            </p>
          </div>
          <ThemeToggle className="flex-shrink-0 mt-1" />
        </div>
        <AgentControls />
      </div>
    </div>
  );
}
