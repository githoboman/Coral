import { useNavigate, Link, useLocation } from 'react-router-dom';
import {
  MessageSquare,
  BarChart2,
  Bell,
  Clock,
  User,
  PanelLeft,
  ChevronRight
} from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { fetchChats } from '@/store/slices/chatsSlice';

interface SidebarProps {
  navItems: Array<{
    name: string;
    to: string;
    icon: keyof typeof iconMap;
    active: boolean;
    hasSubmenu?: boolean;
    subItems?: Array<{ name: string; to: string }>;
  }>;
  onSignOut?: () => void;
}

const iconMap = {
  messageSquare: MessageSquare,
  activity: BarChart2,
  bell: Bell,
  clock: Clock,
  profile: User,
};

export function Sidebar({ navItems }: SidebarProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isRecentsOpen, setIsRecentsOpen] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const recentsRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const currentAccount = useCurrentAccount();
  const user_id = currentAccount?.address;

  // Get chats and current chat ID from Redux
  const chats = useAppSelector(state => state.chats.chats);
  const currentChatId = useAppSelector(state => state.chats.currentChatId);

  // Fetch chats if not already loaded
  useEffect(() => {
    if (user_id && chats.length === 0) {
      dispatch(fetchChats({ userId: user_id }));
    }
  }, [user_id, dispatch, chats.length]);

  // Sort chats by last updated
  const sortedChats = [...chats].sort((a, b) =>
    new Date(b.last_updated).getTime() - new Date(a.last_updated).getTime()
  ).slice(0, 10); // Show up to 10 recent chats

  const toggleSidebar = () => {
    setIsCollapsed(!isCollapsed);
  };

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
  }, [navItems, isCollapsed, location.pathname]);

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

  useGSAP(() => {
    if (recentsRef.current) {
      if (isRecentsOpen && !isCollapsed) {
        gsap.to(recentsRef.current, { height: 'auto', opacity: 1, duration: 0.4, ease: 'power2.out' });
      } else {
        gsap.to(recentsRef.current, { height: 0, opacity: 0, duration: 0.3, ease: 'power2.in' });
      }
    }
  }, [isRecentsOpen, isCollapsed]);



  return (
    <div
      ref={containerRef}
      className="h-[calc(100dvh-32px)] bg-[#070B0F] border border-white/5 rounded-[30px] flex flex-col relative shadow-2xl overflow-hidden will-change-[width]"
    >
      {/* Floating Indicator */}
      <div
        ref={indicatorRef}
        className="absolute left-0 w-[3px] h-[40px] bg-[#B7FC0D] rounded-r-full z-50 pointer-events-none opacity-0 shadow-[0_0_12px_rgba(183,252,13,0.4)]"
      />

      {/* Header */}
      <div className={`flex items-center mb-6 h-14 overflow-hidden transition-all duration-300 ${isCollapsed ? 'justify-center px-0' : 'p-4 justify-between'}`}>
        <div className={`flex items-center gap-3 cursor-pointer min-w-0 ${isCollapsed ? 'justify-center' : ''}`} onClick={() => (window.location.href = '/')}>
          <div className="w-10 h-10 flex items-center justify-center overflow-hidden flex-shrink-0">
            <img src="/assets/logo.png" alt="Logo" className="w-5 h-5 object-contain" />
          </div>
          {!isCollapsed && <span className="sidebar-label text-[22px] font-bold text-white tracking-tight truncate">Tovira</span>}
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
      <nav className="flex-1 px-2 space-y-1 overflow-y-auto no-scrollbar">
        {navItems.map((item) => {
          const Icon = iconMap[item.icon] || MessageSquare;
          const isRecents = item.icon === 'clock';

          return (
            <div key={item.name} className="flex flex-col">
              <Link
                to={isRecents ? "#" : item.to}
                onClick={(e) => {
                  if (isRecents) {
                    e.preventDefault();
                    setIsRecentsOpen(!isRecentsOpen);
                    if (isCollapsed) setIsCollapsed(false);
                  }
                }}
                className={`sidebar-link group relative flex items-center h-12 rounded-2xl cursor-pointer transition-all duration-300
                  ${item.active ? 'bg-white/10 text-white shadow-lg sidebar-link-active' : 'text-white/40 hover:text-white hover:bg-white/5'}
                  ${isCollapsed ? 'justify-center px-0' : 'px-4 gap-3'}
                `}
              >
                <div className="flex-shrink-0 flex items-center justify-center w-6 h-6">
                  <Icon
                    size={20}
                    className={`${item.active ? 'text-white' : 'group-hover:text-white'} transition-colors duration-200`}
                  />
                </div>

                {!isCollapsed && (
                  <div className="sidebar-label flex flex-1 items-center justify-between min-w-0">
                    <span className="text-[17px] font-bold tracking-tight truncate pl-3">{item.name}</span>
                    {isRecents && (
                      <ChevronRight
                        size={16}
                        className={`transition-transform duration-300 flex-shrink-0 ${isRecentsOpen ? 'rotate-90' : ''} text-white/40`}
                      />
                    )}
                  </div>
                )}
              </Link>

              {/* Recents Accordion */}
              {isRecents && (
                <div
                  ref={recentsRef}
                  className="overflow-hidden flex flex-col pl-10 pr-3 space-y-2 opacity-0 h-0"
                >
                  <div className="py-1.5 space-y-2">
                    {sortedChats.map((chat) => (
                      <button
                        key={chat.chat_id}
                        onClick={() => {
                          navigate(`/${chat.chat_id}`);
                        }}
                        className={`text-[12px] text-left transition-colors truncate cursor-pointer w-full block
                          ${chat.chat_id === currentChatId ? 'text-white' : 'text-white/30 hover:text-white/60'}
                        `}
                      >
                        {chat.name || "Untitled Chat"}
                      </button>
                    ))}
                    {sortedChats.length === 0 && (
                      <span className="text-[10px] text-white/20 italic">No recent chats</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Bottom Actions */}
      <div className="p-2 border-t border-white/5 space-y-1 overflow-hidden">
        <Link
          to="/account"
          className={`sidebar-link group flex items-center h-12 rounded-2xl text-white/40 hover:text-white hover:bg-white/5 cursor-pointer overflow-hidden transition-all duration-300
            ${location.pathname === '/account' ? 'bg-white/10 text-white sidebar-link-active' : ''}
            ${isCollapsed ? 'justify-center px-0' : 'px-4 gap-3'}
          `}
        >
          <div className="flex-shrink-0 flex items-center justify-center w-6 h-6">
            <User size={20} />
          </div>
          {!isCollapsed && <span className="sidebar-label text-[17px] font-bold tracking-tight truncate pl-3">Profile</span>}
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
