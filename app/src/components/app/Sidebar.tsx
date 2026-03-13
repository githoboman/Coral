import { Link, useLocation } from "react-router-dom";
import { PanelLeft } from "lucide-react";
import { useState, useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

interface SidebarProps {
  navItems: Array<{
    name: string;
    to: string;
    iconUrl: string;
    active: boolean;
    showDot?: boolean;
    filterWhite?: boolean;
  }>;
  onSignOut?: () => void;
  isCollapsed?: boolean;
  onToggle?: () => void;
}

export function Sidebar({
  navItems,
  isCollapsed: controlledCollapsed,
  onToggle,
}: SidebarProps) {
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const isCollapsed = controlledCollapsed ?? internalCollapsed;

  /* Hooks for navigation and layout */
  const containerRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);
  const location = useLocation();

  const toggleSidebar = () => {
    if (onToggle) {
      onToggle();
    } else {
      setInternalCollapsed(!internalCollapsed);
    }
  };

  useGSAP(() => {
    const activeLink = containerRef.current?.querySelector(
      ".sidebar-link-active",
    );
    if (activeLink && indicatorRef.current) {
      const rect = activeLink.getBoundingClientRect();
      const parentRect = containerRef.current!.getBoundingClientRect();
      const targetY = rect.top - parentRect.top + rect.height / 2 - 20; // 20 is half of 40px height

      gsap.to(indicatorRef.current, {
        y: targetY,
        opacity: 1,
        duration: 0.4,
        ease: "expo.out",
        overwrite: true,
      });
    } else if (indicatorRef.current) {
      gsap.to(indicatorRef.current, { opacity: 0, duration: 0.2 });
    }
  }, [navItems, isCollapsed, location.pathname]);

  useGSAP(() => {
    if (!containerRef.current) return;
    const q = gsap.utils.selector(containerRef.current);

    const tl = gsap.timeline({
      defaults: { ease: "power2.out", duration: 0.35 },
    });

    tl.to(
      containerRef.current,
      {
        width: isCollapsed ? 64 : 240,
      },
      0,
    );

    const labels = q(".sidebar-label");
    if (labels.length > 0) {
      tl.to(
        labels,
        {
          opacity: isCollapsed ? 0 : 1,
          x: isCollapsed ? -20 : 0,
          pointerEvents: isCollapsed ? "none" : "auto",
          duration: 0.25,
        },
        0,
      );
    }

    const toggle = q(".sidebar-header-toggle");
    if (toggle.length > 0) {
      tl.to(
        toggle,
        {
          opacity: isCollapsed ? 0 : 1,
          pointerEvents: isCollapsed ? "none" : "auto",
          duration: 0.2,
        },
        0,
      );
    }
  }, [isCollapsed]);

  /* Recents GSAP animation removed */

  return (
    <div
      ref={containerRef}
      className="h-[calc(100dvh-32px)] bg-[#0A0A0A] border border-white/10 rounded-[40px] flex flex-col relative shadow-2xl overflow-hidden will-change-[width]"
    >
      {/* Floating Indicator */}
      <div
        ref={indicatorRef}
        className="absolute left-0 w-[4px] h-[32px] bg-[#B7FC0D] rounded-r-full top-1 z-50 pointer-events-none opacity-0 shadow-[0_0_12px_rgba(183,252,13,0.4)]"
      />

      {/* Header */}
      <div
        className={`flex items-center mb-6 mt-6 h-14 overflow-hidden transition-all p-6 duration-300 ${isCollapsed ? "justify-center px-0" : "p-4 justify-between"}`}
      >
        <div
          className={`flex items-center gap-3 cursor-pointer min-w-0 ${isCollapsed ? "justify-center" : ""}`}
          onClick={() => (window.location.href = "/")}
        >
          <div className="w-10 h-10 flex items-center justify-center overflow-hidden flex-shrink-0">
            <img
              src="/assets/logo.png"
              alt="Logo"
              className="w-10 h-10 object-contain"
            />
          </div>
          {!isCollapsed && (
            <span className="sidebar-label text-[25px] font-black text-white tracking-tight truncate">
              Tovira
            </span>
          )}
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
      <nav className="flex-1 px-2 space-y-2 no-scrollbar">
        {navItems.map((item) => {
          return (
            <div key={item.name} className="flex flex-col">
              <Link
                to={item.to}
                className={`sidebar-link group relative flex items-center h-12 rounded-2xl cursor-pointer transition-all duration-300
                  ${item.active ? "bg-white/5 text-white shadow-inner sidebar-link-active" : "text-white/40 hover:text-white hover:bg-white/5"}
                  ${isCollapsed ? "justify-center px-0" : "px-4 gap-3"}
                `}
              >
                <div className="flex-shrink-0 flex items-center justify-center w-6 h-6">
                  <img
                    src={item.iconUrl}
                    alt={item.name}
                    className={`w-5 h-5 object-contain transition-opacity duration-200 ${item.active ? "opacity-100" : "opacity-50 group-hover:opacity-100"}`}
                    style={
                      item.filterWhite
                        ? { filter: "brightness(0) invert(1)" }
                        : undefined
                    }
                  />
                  {isCollapsed && item.showDot && (
                    <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-[#B7FC0D] shadow-[0_0_8px_rgba(183,252,13,0.8)]" />
                  )}
                </div>

                {!isCollapsed && (
                  <div className="sidebar-label flex flex-1 items-center justify-between min-w-0">
                    <span className="text-[15px] font-[500] tracking-tight truncate pl-3">
                      {item.name}
                    </span>
                    {item.showDot && (
                      <div className="w-2 h-2 rounded-full bg-[#B7FC0D] shadow-[0_0_8px_rgba(183,252,13,0.8)] mr-1" />
                    )}
                  </div>
                )}
              </Link>
            </div>
          );
        })}
      </nav>

      {/* Bottom Actions */}
      <div className="p-2 pt-4 space-y-4 overflow-hidden mb-2">
        {/* Toggle Sidebar Button moved here to match Image 1 layout */}
        <button
          onClick={toggleSidebar}
          className={`sidebar-link group flex items-center h-12 rounded-2xl text-white/40 hover:text-white hover:bg-white/5 cursor-pointer overflow-hidden transition-all duration-300 w-full
            ${isCollapsed ? "justify-center px-0" : "hidden px-4 gap-3"}
          `}
        >
          <div className="flex-shrink-0 flex items-center justify-center w-6 h-6">
            <PanelLeft
              size={20}
              className="transition-opacity duration-200 opacity-50 group-hover:opacity-100"
            />
          </div>
          {!isCollapsed && (
            <span className="sidebar-label text-[15px] font-[500] tracking-tight truncate pl-3">
              Collapse
            </span>
          )}
        </button>

        <Link
          to="/account"
          className={`sidebar-link group flex items-center h-12 rounded-2xl text-white/40 hover:text-white hover:bg-white/5 cursor-pointer overflow-hidden transition-all duration-300
            ${location.pathname === "/account" ? "bg-white/5 text-white sidebar-link-active" : ""}
            ${isCollapsed ? "justify-center px-0" : "px-4 gap-3"}
          `}
        >
          <div className="flex-shrink-0 flex items-center justify-center w-6 h-6">
            <img
              src="/assets/icons/user.svg"
              alt="Profile"
              className={`w-5 h-5 object-contain transition-opacity duration-200 ${location.pathname === "/account" ? "opacity-100" : "opacity-50 group-hover:opacity-100"}`}
            />
          </div>
          {!isCollapsed && (
            <span className="sidebar-label text-[15px] font-[500] tracking-tight truncate pl-3">
              Profile
            </span>
          )}
        </Link>
      </div>
    </div>
  );
}
