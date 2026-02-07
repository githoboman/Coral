'use client';

import Link from 'next/link';
import { useRef } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';

interface BottomNavProps {
  navItems: Array<{
    name: string;
    to: string;
    iconUrl: string;
    active: boolean;
  }>;
}

export function BottomNav({ navItems }: BottomNavProps) {
  const navRef = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    gsap.fromTo(navRef.current, { y: 100, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: 'power3.out' });
  }, []);

  return (
    <div
      ref={navRef}
      className="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-gradient-to-t from-[#010103] to-[#1a1a1a]/95 backdrop-blur-xl border-t border-white/10"
    >
      <div className="safe-area-inset-bottom">
        <nav className="flex items-center justify-around px-2 py-3">
          {navItems.map((item) => {
            return (
              <Link
                key={item.name}
                href={item.to}
                className={`flex flex-col items-center justify-center gap-1 px-4 py-2 rounded-xl transition-all duration-200 min-w-[64px] ${item.active
                  ? 'bg-gradient-to-r from-[#ffffff]/5 to-[#fdfdfd]/5 text-white'
                  : 'text-white/60 hover:text-white hover:bg-white/5'
                  }`}
              >
                <img
                  src={item.iconUrl}
                  alt={item.name}
                  className={`flex-shrink-0 w-5 h-5 object-contain transition-opacity duration-200 ${item.active ? 'opacity-100' : 'opacity-50 group-hover:opacity-100'}`}
                />
                <span className="text-[10px] font-medium">{item.name}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
