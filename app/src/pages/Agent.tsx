import AgentControls from "@/components/agent/AgentControls";

/**
 * Agent page — the Autonomous Agent Wallet control panel. Rendered inside the
 * CorralLayout shell (which provides the sidebar, header, theme toggle, and the
 * #FAF9F6 / #262626 page background), so this page is just the content.
 */
export default function Agent() {
  return (
    <div className="px-4 py-6 md:px-8 md:py-10">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-[26px] font-bold text-zinc-900 dark:text-zinc-50 mb-1 leading-tight">
            Autonomous Agent
          </h1>
          <p className="text-[13px] text-[#5E5E5E] dark:text-zinc-400 max-w-[560px]">
            Delegate on-chain trading to an agent within policy limits you set once — enforced
            on-chain. Instruct it in plain language, and revoke any time.
          </p>
        </div>
        <AgentControls />
      </div>
    </div>
  );
}
