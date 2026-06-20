import AgentControls from "@/components/agent/AgentControls";

/**
 * Agent page — hosts the Autonomous Agent Wallet control panel. Rendered inside
 * AppLayout, reachable from the "Agent" nav item. Kept as a single-column panel so
 * it reads like a sidebar surface for the demo.
 */
export default function Agent() {
  return (
    <div className="w-full min-h-dvh px-4 py-6 md:px-8 md:py-10">
      <div className="max-w-md mx-auto">
        <h1 className="text-2xl font-black text-white mb-1">Autonomous Agent</h1>
        <p className="text-sm text-white/50 mb-6">
          Delegate on-chain trading to an agent inside policy limits you set. Revoke any time.
        </p>
        <AgentControls />
      </div>
    </div>
  );
}
