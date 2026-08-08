import { useEffect } from "react";
import { FiX, FiPlayCircle } from "react-icons/fi";
import { CoralGuide } from "./CoralGuide";

/**
 * In-dashboard help popup — explains policies + agent tasks without leaving the
 * app. Opened from the header "?" button. Reuses the shared CoralGuide content,
 * and offers to replay the first-run tutorial.
 */
export function HelpModal({ onClose, onReplayTutorial }: { onClose: () => void; onReplayTutorial?: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center overflow-y-auto bg-black/40 backdrop-blur-sm p-4 sm:p-8" onClick={onClose}>
      <div
        className="relative w-full max-w-2xl my-auto rounded-[28px] border border-line bg-surface shadow-[0_30px_80px_rgba(0,0,0,0.3)] p-6 sm:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-6">
          <div>
            <h2 className="text-[22px] font-bold text-ink leading-tight">How Coral works</h2>
            <p className="text-[13px] text-muted mt-1">Policies, limits, and everything you can ask the agent to do.</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {onReplayTutorial && (
              <button
                onClick={onReplayTutorial}
                className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-3 text-[12px] font-semibold text-ink px-3 py-2 hover:border-[var(--brand)]/50 hover:text-[var(--brand)] transition-all cursor-pointer"
                title="Replay the quick tutorial"
              >
                <FiPlayCircle className="w-3.5 h-3.5" /> Tutorial
              </button>
            )}
            <button
              onClick={onClose}
              className="w-9 h-9 rounded-full flex items-center justify-center border border-line bg-surface-3 text-muted hover:text-ink transition-all cursor-pointer active:scale-95"
              title="Close"
            >
              <FiX className="w-4 h-4" />
            </button>
          </div>
        </div>
        <CoralGuide variant="app" />
      </div>
    </div>
  );
}
