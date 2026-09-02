/**
 * The activity feed (FR-11.6, FR-7.3, FR-7.4).
 *
 * The requirement with teeth is FR-11.6: **failures and aborts must be
 * visually distinct from rejections.** That is not a styling preference. A
 * rejection means the on-chain policy refused something — the system worked
 * exactly as designed and the user's money was protected. A failure means
 * something broke. Rendering them the same way teaches people to read their
 * own protection as a fault, which is precisely backwards.
 *
 * Everything shown comes from the indexer's projection of chain logs, so the
 * price and slippage are what actually happened, not what we hoped for.
 */
import type { ExecutionView } from "../lib/api";
import { amount, present, wei } from "../lib/display";

const TONE_STYLES: Record<string, string> = {
  success: "border-emerald-500/30 bg-emerald-500/[0.04]",
  // Refusals get the calm treatment: the limits worked.
  refused: "border-sky-500/30 bg-sky-500/[0.04]",
  failure: "border-red-500/30 bg-red-500/[0.04]",
  pending: "border-white/10 bg-white/[0.02]",
  ended: "border-white/10 bg-white/[0.02]",
};

const TONE_LABEL: Record<string, string> = {
  success: "text-emerald-300",
  refused: "text-sky-300",
  failure: "text-red-300",
  pending: "text-white/60",
  ended: "text-white/50",
};

function Slippage({ bps }: { bps: number }) {
  if (bps === 0) return <span className="text-white/50">exactly as quoted</span>;
  // Negative means better than quoted. Showing that as a loss would be a lie.
  return bps < 0 ? (
    <span className="text-emerald-300">{(-bps / 100).toFixed(2)}% better than quoted</span>
  ) : (
    <span className="text-white/60">{(bps / 100).toFixed(2)}% below quote</span>
  );
}

export function ActivityFeed({
  executions,
  assets,
  explorerBase = "https://sepolia.basescan.org",
}: {
  executions: readonly ExecutionView[];
  assets: { symbol: string; address: string | null }[];
  explorerBase?: string;
}) {
  const symbolOf = (address: string | null): string =>
    assets.find((a) => (a.address ?? "").toLowerCase() === (address ?? "").toLowerCase())?.symbol ?? "";

  return (
    <ul className="space-y-3">
      {executions.map((x) => {
        const p = present(x.status, x.errorCode);
        return (
          <li key={x.id} className={`rounded-lg border p-4 ${TONE_STYLES[p.tone] ?? TONE_STYLES["pending"]}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className={`text-sm font-semibold ${TONE_LABEL[p.tone] ?? ""}`}>{p.label}</span>
              <time className="text-xs text-white/40" dateTime={x.scheduledFor}>
                {new Date(x.scheduledFor).toLocaleString()}
              </time>
            </div>

            {x.trade ? (
              <p className="mt-2 text-sm text-white/85">
                Swapped {amount(x.trade.amountIn, x.trade.assetIn, symbolOf(x.trade.assetIn))} for{" "}
                {amount(x.trade.realisedOut ?? x.trade.quotedOut, x.trade.assetOut, symbolOf(x.trade.assetOut))}
                {x.trade.venue ? <span className="text-white/50"> on {x.trade.venue}</span> : null}
              </p>
            ) : null}

            {/* Plain-language cause on everything that did not succeed (FR-7.4). */}
            {p.tone !== "success" ? <p className="mt-2 text-sm text-white/70">{p.explanation}</p> : null}

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/45">
              {x.trade?.slippageBps !== null && x.trade?.slippageBps !== undefined ? (
                <span>
                  Price: <Slippage bps={x.trade.slippageBps} />
                </span>
              ) : null}
              {/* Gas sits in its own field, never folded into the amounts above. */}
              {x.gas ? <span>Network fee: {wei(x.gas.costWei)}</span> : null}
              {x.txHash ? (
                <a
                  href={`${explorerBase}/tx/${x.txHash}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="underline hover:text-white/70"
                >
                  View on the explorer
                </a>
              ) : null}
              {x.intentHash ? (
                <span className="font-mono text-[10px] text-white/25" title="The intent this run came from">
                  {x.intentHash.slice(0, 12)}…
                </span>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
