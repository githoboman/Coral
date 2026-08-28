/**
 * The Corral shell.
 *
 * Exists for one requirement: FR-11.4, the kill switch reachable in **one tap
 * from every authenticated screen**. Putting it on individual pages would
 * satisfy the letter of that and miss the point — the moment someone wants
 * this is the moment they are least willing to navigate.
 *
 * So it lives in the shell, pinned, on every screen inside it. The bar also
 * carries the standalone `/revoke` link, which is the path that still works
 * when everything else here is down (FR-8.3).
 */
import { useState } from "react";
import { Outlet, useParams } from "react-router-dom";

import { KillSwitch } from "../components/KillSwitch";

export default function CorralLayout() {
  const { id } = useParams();
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#0b0b0d] text-white">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#0b0b0d]/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3">
          <a href="/corral" className="text-sm font-semibold tracking-tight">
            Corral
          </a>

          <div className="flex items-center gap-3">
            {/* One tap, from anywhere in this area. */}
            {id ? (
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                aria-controls="kill-switch-panel"
                className="rounded-md border border-red-500/50 px-3 py-1.5 text-sm font-medium text-red-300 hover:bg-red-500/10"
              >
                Stop this agent
              </button>
            ) : null}
            <a
              href="/revoke"
              className="text-xs text-white/40 underline hover:text-white/70"
              title="Works even if Corral is completely down"
            >
              Emergency revoke
            </a>
          </div>
        </div>

        {open && id ? (
          <div id="kill-switch-panel" className="border-t border-white/10 bg-[#0b0b0d]">
            <div className="mx-auto max-w-3xl px-4 py-4">
              <KillSwitch sessionId={id} />
            </div>
          </div>
        ) : null}
      </header>

      <main>
        <Outlet />
      </main>

      <footer className="mx-auto max-w-3xl px-4 py-10 text-xs text-white/30">
        <p>
          Your limits are enforced by your own account on Base, not by this website. Corral cannot move your funds and
          holds no key that could.
        </p>
      </footer>
    </div>
  );
}
