import { useEffect, useState } from "react";
import { toDataURL } from "qrcode";

/**
 * Renders a QR code for a string (e.g. a wallet address) as an <img> data-URL.
 * Uses the `qrcode` lib's toDataURL — no extra React dependency.
 */
export function QrCode({ value, size = 160 }: { value: string; size?: number }) {
  const [src, setSrc] = useState<string>("");

  useEffect(() => {
    let alive = true;
    if (!value) return;
    toDataURL(value, { width: size, margin: 1, color: { dark: "#0A0A0A", light: "#FFFFFF" } })
      .then((url: string) => {
        if (alive) setSrc(url);
      })
      .catch(() => {
        if (alive) setSrc("");
      });
    return () => {
      alive = false;
    };
  }, [value, size]);

  return src ? (
    <img src={src} alt="Address QR" width={size} height={size} className="rounded-xl bg-white p-2" />
  ) : (
    <div style={{ width: size, height: size }} className="rounded-xl bg-surface-3 animate-pulse" />
  );
}
