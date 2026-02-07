'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PanelLeft } from 'lucide-react';
import { useState, useRef } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';

interface SidebarProps {
  navItems: Array<{
    name: string;
    to: string;
    iconUrl: string;
    active: boolean;
  }>;
  onSignOut?: () => void;
}

export function Sidebar({ navItems }: SidebarProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  const toggleSidebar = () => {
    setIsCollapsed(!isCollapsed);
  };

  useGSAP(() => {
    const activeLink = containerRef.current?.querySelector('.sidebar-link-active');
    if (activeLink && indicatorRef.current) {
      const rect = activeLink.getBoundingClientRect();
      const parentRect = containerRef.current!.getBoundingClientRect();
      const targetY = rect.top - parentRect.top + (rect.height / 2) - 20;

      gsap.to(indicatorRef.current, {
        y: targetY,
        opacity: 1,
        duration: 0.4,
        ease: 'expo.out',
        overwrite: true
      });
    } else if (indicatorRef.current) {
      gsap.to(indicatorRef.current, { opacity: 0, duration: 0.2 });
    }
  }, [navItems, isCollapsed, pathname]);

  useGSAP(() => {
    const tl = gsap.timeline({ defaults: { ease: 'power2.out', duration: 0.35 } });

    tl.to(containerRef.current, {
      width: isCollapsed ? 64 : 240,
    }, 0);

    tl.to(".sidebar-label", {
      opacity: isCollapsed ? 0 : 1,
      x: isCollapsed ? -20 : 0,
      pointerEvents: isCollapsed ? 'none' : 'auto',
      duration: 0.25,
    }, 0);

    tl.to(".sidebar-header-toggle", {
      opacity: isCollapsed ? 0 : 1,
      pointerEvents: isCollapsed ? 'none' : 'auto',
      duration: 0.2
    }, 0);
  }, [isCollapsed]);

  return (
    <div
      ref={containerRef}
      className="h-[calc(100dvh-32px)] bg-white/5 border border-white/5 rounded-[30px] flex flex-col relative shadow-2xl overflow-hidden will-change-[width]"
    >
      {/* Floating Indicator */}
      <div
        ref={indicatorRef}
        className="absolute left-0 w-[3px] h-[40px] bg-[#B7FC0D] rounded-r-full z-50 pointer-events-none opacity-0 shadow-[0_0_12px_rgba(183,252,13,0.4)]"
      />

      {/* Header */}
      <div className={`flex items-center mb-6 h-14 overflow-hidden transition-all p-6 duration-300 ${isCollapsed ? 'justify-center px-0' : 'p-4 justify-between'}`}>
        <div className={`flex items-center gap-3 cursor-pointer min-w-0 ${isCollapsed ? 'justify-center' : ''}`} onClick={() => (window.location.href = '/')}>
          <div className="w-10 h-10 flex items-center justify-center overflow-hidden flex-shrink-0">
            <img src="/assets/logo.png" alt="Logo" className="w-10 h-10 object-contain" />
          </div>
          {!isCollapsed && <span className="sidebar-label text-[25px] font-black text-white tracking-tight truncate">Tovira</span>}
        </div>
        {!isCollapsed && (
          <button
            onClick={toggleSidebar}
            className="sidebar-header-toggle text-white/40 hover:text-white transition-colors p-1 cursor-pointer flex-shrink-0"
          >
            <PanelLeft size={20} />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2 space-y-2 overflow-y-auto no-scrollbar py-4">
        {navItems.map((item) => {
          return (
            <div key={item.name} className="flex flex-col">
              <Link
                href={item.to}
                className={`sidebar-link group relative flex items-center h-12 rounded-2xl cursor-pointer transition-all duration-300
                  ${item.active ? 'bg-white/10 text-white shadow-lg sidebar-link-active' : 'text-white/40 hover:text-white hover:bg-white/5'}
                  ${isCollapsed ? 'justify-center px-0' : 'px-4 gap-3'}
                `}
              >
                <div className="flex-shrink-0 flex items-center justify-center w-6 h-6">
                  <img
                    src={item.iconUrl}
                    alt={item.name}
                    className={`w-5 h-5 object-contain transition-opacity duration-200 ${item.active ? 'opacity-100' : 'opacity-50 group-hover:opacity-100'}`}
                  />
                </div>

                {!isCollapsed && (
                  <div className="sidebar-label flex flex-1 items-center justify-between min-w-0">
                    <span className="text-[17px] font-[400] tracking-tight truncate pl-3">{item.name}</span>
                  </div>
                )}
              </Link>
            </div>
          );
        })}
      </nav>

      {/* Bottom Actions */}
      <div className="p-2 border-t border-white/5 space-y-1 overflow-hidden">
        <Link
          href="/account"
          className={`sidebar-link group flex items-center h-12 rounded-2xl text-white/40 hover:text-white hover:bg-white/5 cursor-pointer overflow-hidden transition-all duration-300
            ${pathname === '/account' ? 'bg-white/10 text-white sidebar-link-active' : ''}
            ${isCollapsed ? 'justify-center px-0' : 'px-4 gap-3'}
          `}
        >
          <div className="flex-shrink-0 flex items-center justify-center w-6 h-6">
            <img
              src="/assets/icons/user.svg"
              alt="Profile"
              className={`w-5 h-5 object-contain transition-opacity duration-200 ${pathname === '/account' ? 'opacity-100' : 'opacity-50 group-hover:opacity-100'}`}
            />
          </div>
          {!isCollapsed && <span className="sidebar-label text-[17px] font-[400] tracking-tight truncate pl-3">Profile</span>}
        </Link>
      </div>

      {/* Collapse toggle for collapsed state */}
      <button
        onClick={toggleSidebar}
        className={`absolute bottom-16 left-1/2 -translate-x-1/2 p-2 text-white/20 hover:text-white transition-all cursor-pointer ${isCollapsed ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      >
        <PanelLeft size={20} />
      </button>
    </div>
  );
}
