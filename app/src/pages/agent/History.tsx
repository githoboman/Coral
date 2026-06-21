/**
 * Agent History — placeholder, matching corral's `history` screen. The live
 * execution history surfaces on the Activities page (bound to the alert feed);
 * this is reserved for a future archived/Walrus history view.
 */
export default function History() {
  return (
    <div className="flex flex-col flex-1 items-center justify-center p-8 min-h-[60vh]">
      <div className="w-full max-w-md rounded-2xl bg-zinc-50 p-8 shadow-sm dark:bg-[#2F2F2F] border border-[#E7E7E4] dark:border-black">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">History</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Archived agent history will appear here. Live executions are on the{" "}
          <a href="/agent/activity" className="underline">Activities</a> page.
        </p>
      </div>
    </div>
  );
}
