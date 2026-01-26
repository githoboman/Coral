import { Link, useNavigate } from 'react-router-dom';
import { Bell, User, MessageSquare, Activity, X, Clock, ChevronRight, Layout } from 'lucide-react';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { useEffect } from 'react';
import { fetchChats } from '@/store/slices/chatsSlice';

interface MobileDashboardSidebarProps {
  navItems: Array<{
    name: string;
    to: string;
    icon: keyof typeof iconMap;
    active: boolean;
  }>;
  onClose?: () => void;
}

const iconMap = {
  profile: User,
  messageSquare: MessageSquare,
  bell: Bell,
  activity: Activity,
  clock: Clock,
};

export function MobileDashboardSidebar({ navItems, onClose }: MobileDashboardSidebarProps) {
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
  ).slice(0, 5); // Show only 5 most recent

  return (
    <div className="h-full flex flex-col bg-black text-white overflow-hidden">
      {/* Header */}
      <div className="p-7 flex items-center justify-between">
        <div className="flex items-center gap-4 cursor-pointer" onClick={() => navigate('/')}>
          <div className="w-10 h-10 flex items-center justify-center">
            <img
              src="/assets/images/signin-logo.png"
              alt="Tovira Logo"
              className="h-full w-full object-contain"
            />
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">
            Tovira
          </h1>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-2 text-white/80 hover:text-white transition-colors cursor-pointer"
          >
            <Layout size={24} />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 mt-6">
        <ul className="space-y-2 relative">
          {navItems.map((item) => {
            const Icon = iconMap[item.icon] || MessageSquare;
            const isRecents = item.name === 'Recents';

            return (
              <li key={item.name} className="relative">
                {/* Active Indicator (Lime Bar) */}
                {item.active && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[6px] h-3/5 bg-[#8BEE1C] rounded-r-md z-10" />
                )}

                <div className="px-3">
                  <Link
                    to={item.to}
                    onClick={isRecents ? (e) => e.preventDefault() : onClose}
                    className={`group flex items-center px-5 py-4 rounded-[18px] transition-all duration-300 gap-5 cursor-pointer relative ${item.active
                      ? 'bg-[#1C1C1E] text-white'
                      : 'text-white/60 hover:text-white'
                      }`}
                  >
                    <Icon
                      className={`flex-shrink-0 ${item.active ? 'text-white' : 'text-white/60 group-hover:text-white'
                        } transition-colors duration-200`}
                      size={24}
                    />
                    <div className="flex-1 flex items-center justify-between">
                      <span className="text-[20px] font-medium tracking-tight leading-none">{item.name}</span>
                      {isRecents && (
                        <ChevronRight size={18} className="text-white/40" />
                      )}
                    </div>
                  </Link>

                  {/* Sub-items for Recents */}
                  {isRecents && sortedChats.length > 0 && (
                    <div className="mt-4 ml-12 space-y-5">
                      {sortedChats.map((chat) => (
                        <button
                          key={chat.chat_id}
                          onClick={() => {
                            navigate(`/${chat.chat_id}`);
                            onClose?.();
                          }}
                          className={`w-full text-left transition-colors cursor-pointer text-[17px] font-medium tracking-tight truncate ${chat.chat_id === currentChatId ? 'text-white' : 'text-white/40 hover:text-white'}`}
                        >
                          {chat.name || "Untitled Chat"}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Footer Profile */}
      <div className="p-4 px-3 mb-4">
        <Link
          to="/account"
          onClick={onClose}
          className="flex items-center px-5 py-4 rounded-[18px] gap-5 text-white/60 hover:text-white transition-all cursor-pointer"
        >
          <User size={24} className="flex-shrink-0" />
          <span className="text-[20px] font-medium tracking-tight leading-none">Profile</span>
        </Link>
      </div>
    </div>
  );
}
