import { useState, useEffect } from "react";
import { Hammer } from "lucide-react";

export default function Maintenance() {
  const [timeLeft, setTimeLeft] = useState({ hours: 0, minutes: 0, seconds: 0 });

  useEffect(() => {
    const calculateTimeLeft = () => {
      const now = new Date();
      const target = new Date();
      target.setHours(19, 0, 0, 0); // 7 PM today

      const difference = target.getTime() - now.getTime();

      if (difference > 0) {
        setTimeLeft({
          hours: Math.floor((difference / (1000 * 60 * 60)) % 24),
          minutes: Math.floor((difference / 1000 / 60) % 60),
          seconds: Math.floor((difference / 1000) % 60),
        });
      } else {
        setTimeLeft({ hours: 0, minutes: 0, seconds: 0 });
      }
    };

    calculateTimeLeft();
    const timer = setInterval(calculateTimeLeft, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="min-h-screen w-full bg-[#070B0F] flex flex-col items-center justify-center p-4">
      <div className="fixed inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(139,238,28,0.05),transparent_50%)]" />

      {/* Tovira Logo */}
      <div className="fixed top-5 left-5 z-10">
        <img
          src="/assets/images/signin-logo.png"
          alt="Tovira Logo"
          className="w-20 h-20 object-contain p-2"
        />
      </div>

      {/* Content Container */}
      <div className="relative w-full max-w-[480px] z-10 text-center">
        <div className="bg-[#0D1117]/60 backdrop-blur-xl border border-white/5 rounded-[40px] p-8 md:p-12 shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-[#8BEE1C]/10 rounded-3xl mb-8">
            <Hammer className="w-10 h-10 text-[#8BEE1C]" />
          </div>

          <h2 className="text-[32px] font-[500] text-white tracking-tight mb-4">
            Under{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#8BEE1C] to-[#2B87D1]">
              Maintenance
            </span>
          </h2>

          <p className="text-white/50 text-base leading-relaxed mb-8">
            We're currently performing some scheduled upgrades to improve your experience.
            Thank you for your patience!
          </p>

          {/* Countdown Timer */}
          <div className="flex items-center justify-center gap-3 md:gap-4 mb-10">
            {['Hours', 'Minutes', 'Seconds'].map((label, i) => {
              const value = i === 0 ? timeLeft.hours : i === 1 ? timeLeft.minutes : timeLeft.seconds;
              return (
                <div key={label} className="flex flex-col items-center gap-2">
                  <div className="w-16 h-16 md:w-20 md:h-20 bg-[#0A0A0A] border border-white/10 rounded-2xl flex items-center justify-center shadow-[inset_0_2px_4px_rgba(0,0,0,0.5)] relative overflow-hidden group">
                    <div className="absolute inset-0 bg-[#8BEE1C]/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                    <span className="text-2xl md:text-3xl font-mono font-bold text-white relative z-10">
                      {value.toString().padStart(2, '0')}
                    </span>
                  </div>
                  <span className="text-[10px] font-bold text-white/30 uppercase tracking-wider">{label}</span>
                </div>
              );
            })}
          </div>

          <div className="space-y-6">
            <p className="text-white/40 text-sm font-medium uppercase tracking-widest">
              Follow our socials for updates
            </p>
            <div className="flex items-center justify-center gap-6">
              <a
                href="https://x.com/tovira_sui"
                target="_blank"
                rel="noopener noreferrer"
                className="w-12 h-12 bg-white/5 hover:bg-white/10 border border-white/5 rounded-2xl flex items-center justify-center transition-all duration-300 group hover:-translate-y-1"
              >
                <svg className="w-5 h-5 text-white/60 group-hover:text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.045 4.126H5.078z" />
                </svg>
              </a>
              <a
                href="https://t.me/tovira_xyz"
                target="_blank"
                rel="noopener noreferrer"
                className="w-12 h-12 bg-white/5 hover:bg-white/10 border border-white/5 rounded-2xl flex items-center justify-center transition-all duration-300 group hover:-translate-y-1"
              >
                <svg className="w-5 h-5 text-white/60 group-hover:text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M11.944 0C5.344 0 0 5.344 0 11.944c0 6.6 5.344 11.944 11.944 11.944 6.6 0 11.944-5.344 11.944-11.944C23.888 5.344 18.544 0 11.944 0zm5.833 8.333l-2.028 9.556c-.153.68-.556.847-1.125.528l-3.097-2.278-1.5 1.444c-.167.167-.306.306-.625.306l.222-3.139 5.722-5.167c.25-.222-.056-.347-.389-.125l-7.069 4.444-3.042-.95c-.667-.208-.68-.667.139-.986l11.889-4.583c.556-.208 1.042.125.889.95z" />
                </svg>
              </a>
              <a
                href="https://discord.gg/wpFNFWxRxj"
                target="_blank"
                rel="noopener noreferrer"
                className="w-12 h-12 bg-white/5 hover:bg-white/10 border border-white/5 rounded-2xl flex items-center justify-center transition-all duration-300 group hover:-translate-y-1"
              >
                <svg className="w-5 h-5 text-white/60 group-hover:text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.006 14.006 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.07.07 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
                </svg>
              </a>
            </div>
          </div>
        </div>

        {/* Footer */}
        <p className="mt-8 text-white/20 text-xs">
          © 2026 Tovira Protocol. All systems optimal, just polishing the edges.
        </p>
      </div>
    </div>
  );
}
