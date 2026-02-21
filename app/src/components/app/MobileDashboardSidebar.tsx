import { Link, useLocation } from 'react-router-dom';
import { PanelLeft } from 'lucide-react';
import { useRef } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';

interface MobileDashboardSidebarProps {
  navItems: Array<{
    name: string;
    to: string;
    iconUrl: string;
    active: boolean;
    showDot?: boolean;
  }>;
  onClose?: () => void;
}

export function MobileDashboardSidebar({ navItems, onClose }: MobileDashboardSidebarProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);
  const location = useLocation();

  useGSAP(() => {
    const activeLink = containerRef.current?.querySelector('.sidebar-link-active');
    if (activeLink && indicatorRef.current) {
      const rect = activeLink.getBoundingClientRect();
      const parentRect = containerRef.current!.getBoundingClientRect();
      const targetY = rect.top - parentRect.top + (rect.height / 2) - 20; // 20 is half of 40px height

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
  }, [navItems, location.pathname]);

  return (
    <div
      ref={containerRef}
      className="h-full bg-[#0A0A0A] border border-white/10 rounded-[40px] flex flex-col relative shadow-2xl overflow-hidden w-[240px]"
    >
      {/* Floating Indicator */}
      <div
        ref={indicatorRef}
        className="absolute left-0 w-[4px] h-[32px] bg-[#B7FC0D] rounded-r-full top-1 z-50 pointer-events-none opacity-0 shadow-[0_0_12px_rgba(183,252,13,0.4)]"
      />

      {/* Header */}
      <div className="flex items-center mb-10 mt-6 h-14 overflow-hidden p-6 justify-between">
        <div className="flex items-center gap-3 cursor-pointer min-w-0" onClick={() => (window.location.href = '/')}>
          <div className="w-10 h-10 flex items-center justify-center overflow-hidden flex-shrink-0">
            <img src="/assets/images/signin-logo.png" alt="Logo" className="w-10 h-10 object-contain" />
          </div>
          <span className="text-[25px] font-black text-white tracking-tight truncate">Tovira</span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2 space-y-6 overflow-y-auto no-scrollbar py-6">
        {navItems.map((item) => {
          return (
            <div key={item.name} className="flex flex-col">
              <Link
                to={item.to}
                onClick={onClose}
                className={`sidebar-link group relative flex items-center h-12 rounded-2xl cursor-pointer transition-all duration-300 px-4 gap-3
                  ${item.active ? 'bg-white/5 text-white shadow-inner sidebar-link-active' : 'text-white/40 hover:text-white hover:bg-white/5'}
                `}
              >
                <div className="flex-shrink-0 flex items-center justify-center w-6 h-6">
                  <img
                    src={item.iconUrl}
                    alt={item.name}
                    className={`w-5 h-5 object-contain transition-opacity duration-200 ${item.active ? 'opacity-100' : 'opacity-50 group-hover:opacity-100'}`}
                  />
                </div>

                <div className="flex flex-1 items-center justify-between min-w-0">
                  <span className="text-[15px] font-[500] tracking-tight truncate pl-3">{item.name}</span>
                  {item.showDot && (
                    <div className="w-2 h-2 rounded-full bg-[#B7FC0D] shadow-[0_0_8px_rgba(183,252,13,0.8)] mr-1" />
                  )}
                </div>
              </Link>
            </div>
          );
        })}
      </nav>

      {/* Bottom Actions */}
      <div className="p-2 pt-6 border-t border-white/5 space-y-4 overflow-hidden mb-2">
        <button
          onClick={onClose}
          className="sidebar-link group flex items-center h-12 rounded-2xl text-white/40 hover:text-white hover:bg-white/5 cursor-pointer overflow-hidden transition-all duration-300 w-full px-4 gap-3"
        >
          <div className="flex-shrink-0 flex items-center justify-center w-6 h-6">
            <PanelLeft size={20} className="transition-opacity duration-200 opacity-50 group-hover:opacity-100" />
          </div>
          <span className="text-[15px] font-[500] tracking-tight truncate pl-3">Collapse</span>
        </button>

        <Link
          to="/account"
          onClick={onClose}
          className={`sidebar-link group flex items-center h-12 rounded-2xl text-white/40 hover:text-white hover:bg-white/5 cursor-pointer overflow-hidden transition-all duration-300 px-4 gap-3
            ${location.pathname === '/account' ? 'bg-white/5 text-white sidebar-link-active' : ''}
          `}
        >
          <div className="flex-shrink-0 flex items-center justify-center w-6 h-6">
            <img
              src="/assets/icons/user.svg"
              alt="Profile"
              className={`w-5 h-5 object-contain transition-opacity duration-200 ${location.pathname === '/account' ? 'opacity-100' : 'opacity-50 group-hover:opacity-100'}`}
            />
          </div>
          <span className="text-[15px] font-[500] tracking-tight truncate pl-3">Profile</span>
        </Link>
      </div>
    </div>
  );
}
