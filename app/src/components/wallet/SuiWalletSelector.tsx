import { useConnectWallet, useWallets } from '@mysten/dapp-kit';
import { ChevronRight } from 'lucide-react';
import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';

interface SuiWalletSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  onBackToLogin?: () => void;
}

export function SuiWalletSelector({ isOpen, onClose, onBackToLogin }: SuiWalletSelectorProps) {
  const wallets = useWallets();
  const { mutate: connect } = useConnectWallet();
  const modalRef = useRef<HTMLDivElement>(null);

  // Curated list based on design with local icons
  const curatedWallets = [
    { name: 'OKX wallet', brand: 'OKX', icon: '/assets/icons/wallets/okx.png', color: '#B7FC0D' },
    { name: 'Surf wallet', brand: 'Surf', icon: '/assets/icons/wallets/surf.png', color: '#2D9CDB' },
    { name: 'Slush wallet', brand: 'Slush', icon: '/assets/icons/wallets/slush.png', color: '#2D9CDB', recommended: true },
    { name: 'Keytone wallet', brand: 'Keytone', icon: '/assets/icons/wallets/keytone.png', color: '#FFFFFF' },
    { name: 'Phantom wallet', brand: 'Phantom', icon: '/assets/icons/wallets/phantom.png', color: '#AB9FF2' },
  ];

  // Helper to find installed wallet by name or provider
  const findInstalledWallet = (brandName: string) => {
    return wallets.find(w => w.name.toLowerCase().includes(brandName.toLowerCase()));
  };

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => { document.body.style.overflow = 'unset'; };
  }, [isOpen]);

  useGSAP(() => {
    if (isOpen) {
      gsap.fromTo(modalRef.current, { opacity: 0, scale: 0.95, y: 10 }, { opacity: 1, scale: 1, y: 0, duration: 0.4, ease: 'power3.out' });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[400] flex items-center justify-center p-4 overflow-hidden bg-black/95 backdrop-blur-xl">
      {/* Background patterns */}
      <div className="absolute inset-0 opacity-20 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-[#B7FC0D]/20 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-[#246AFC]/20 rounded-full blur-[120px]" />
      </div>

      {/* Header */}
      <div className="fixed top-0 left-0 right-0 p-8 flex justify-between items-center z-10">
        <button
          onClick={onBackToLogin}
          className="flex items-center gap-2 text-white/60 hover:text-white transition-colors font-medium text-sm group cursor-pointer"
        >
          <ChevronRight size={18} className="rotate-180 group-hover:-translate-x-1 transition-transform" />
          Back
        </button>
      </div>

      <div
        ref={modalRef}
        className="relative w-full max-w-[340px] z-10"
      >
        <div className="bg-[#070B0F] border border-white/10 rounded-[32px] p-5 sm:p-6 shadow-2xl relative overflow-hidden">
          <h2 className="text-xl font-bold text-white text-center mb-6 tracking-tight">
            Connect your sui wallet
          </h2>

          <div className="space-y-2 mb-6">
            {curatedWallets.map((wallet) => {
              const installed = findInstalledWallet(wallet.brand);
              return (
                <button
                  key={wallet.name}
                  onClick={() => {
                    if (installed) {
                      connect({ wallet: installed });
                      onClose();
                    } else {
                      window.open('https://sui.io/ecosystem/wallets', '_blank');
                    }
                  }}
                  className={`w-full group flex items-center justify-between p-2.5 rounded-full transition-all duration-300 cursor-pointer border
                    ${wallet.recommended
                      ? 'bg-white/5 border-white/20'
                      : 'bg-transparent border-transparent hover:bg-white/5 hover:border-white/10'
                    }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center overflow-hidden shadow-md shadow-black/20"
                    >
                      <img src={wallet.icon} alt={wallet.name} className="w-full h-full object-cover" />
                    </div>
                    <span className="font-bold text-sm text-white/90">{wallet.name}</span>
                  </div>
                  {wallet.recommended && <ChevronRight size={16} className="text-white/40 group-hover:text-white/80 group-hover:translate-x-1 transition-all" />}
                </button>
              );
            })}
          </div>

          <div className="text-center mb-6">
            <p className="text-white/40 font-bold text-[10px]">
              Can't find your wallet? <button className="text-[#B7FC0D] hover:underline cursor-pointer">Load more</button>
            </p>
          </div>

          {/* Tovira Wallet Button */}
          <button className="w-full p-0.5 bg-gradient-to-r from-[#246AFC] via-[#2D9CDB] to-[#B7FC0D] rounded-full group cursor-pointer active:scale-[0.98] transition-all overflow-hidden group">
            <div className="bg-gradient-to-r from-[#246AFC] to-[#B7FC0D] w-full h-full rounded-full flex items-center justify-between px-4 py-2.5 shadow-lg">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-black flex items-center justify-center">
                  <img src="/assets/images/signin-logo.png" className="w-4 h-4 object-contain brightness-150" />
                </div>
                <span className="text-black font-extrabold text-[12px] tracking-tight">Create a Tovira wallet instead</span>
              </div>
              <ChevronRight size={16} className="text-black/60 group-hover:text-black group-hover:translate-x-1 transition-transform" />
            </div>
          </button>
        </div>

        {/* Footer text */}
        <div className="mt-6 text-center text-[11px] font-medium leading-tight">
          <p className="text-white/40">
            Get started by signing up with a sui compatible wallet.{' '}
            <button className="text-[#B7FC0D] hover:underline font-bold cursor-pointer transition-colors">What is a wallet?</button>
          </p>
        </div>
      </div>
    </div>
  );
}
