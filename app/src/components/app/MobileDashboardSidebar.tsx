import { Link, useNavigate } from 'react-router-dom';
import { Search, Home, Bell, User, Users, MessageSquare, Activity, X } from 'lucide-react';
import { useAppSelector } from '@/store/hooks';



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
  home: Home,
  profile: User,
  users: Users,
  messageSquare: MessageSquare,
  bell: Bell,
  activity: Activity,
};

export function MobileDashboardSidebar({ navItems, onClose }: MobileDashboardSidebarProps) {
  const navigate = useNavigate();

  // Get chats and current chat ID from Redux
  const chats = useAppSelector(state => state.chats.chats);
  const currentChatId = useAppSelector(state => state.chats.currentChatId);

  // Sort chats by last updated
  const sortedChats = [...chats].sort((a, b) =>
    new Date(b.last_updated).getTime() - new Date(a.last_updated).getTime()
  ).slice(0, 5); // Show only 5 most recent

  return (
    <div className="h-full flex flex-col bg-[#18181B] text-white overflow-hidden">
      <div className="p-6 flex items-center justify-between border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 flex items-center justify-center">
            <img
              src="/assets/logo.png"
              alt="Logo"
              className="h-full w-full object-cover"
            />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white tracking-wide">
              Dashboard
            </h1>
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/10 transition-colors"
          >
            <X size={20} className="text-white/60" />
          </button>
        )}
      </div>

      <div className="p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-white/40" size={16} />
          <input
            type="text"
            placeholder="Search..."
            className="w-full pl-9 pr-4 py-2.5 bg-white/5 rounded-xl text-white/80 placeholder-white/30 border border-white/5 focus:outline-none focus:border-[#00FF88]/50 transition-colors text-sm"
          />
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-4 py-2">
        <ul className="space-y-2">
          {navItems.map((item) => {
            const Icon = iconMap[item.icon] || Home;
            return (
              <li key={item.name}>
                <Link
                  to={item.to}
                  onClick={onClose}
                  className={`group flex items-center px-4 py-3.5 rounded-xl transition-all duration-200 gap-3 ${item.active
                    ? 'bg-[#00FF88]/10 text-[#00FF88]'
                    : 'text-white/60 hover:text-white hover:bg-white/5'
                    }`}
                >
                  <Icon
                    className={`flex-shrink-0 ${item.active ? 'text-[#00FF88]' : 'group-hover:text-white'
                      } transition-colors duration-200`}
                    size={20}
                  />
                  <span className={`text-sm font-medium ${item.active ? 'text-[#00FF88]' : ''}`}>{item.name}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Recent Chats Section */}
      {sortedChats.length > 0 && (
        <div className="px-4 pb-4 border-t border-white/10">
          <h3 className="text-xs font-bold text-white/40 uppercase px-4 py-3">Recent Chats</h3>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {sortedChats.map((chat) => {
              const isActive = chat.chat_id === currentChatId;
              return (
                <button
                  key={chat.chat_id}
                  onClick={() => {
                    navigate(`/${chat.chat_id}`);
                    onClose?.();
                  }}
                  className={`w-full px-4 py-2.5 rounded-lg text-left transition-all duration-200 ${isActive
                    ? 'bg-[#00FF88]/10 text-[#00FF88]'
                    : 'text-white/60 hover:text-white hover:bg-white/5'
                    }`}
                >
                  <p className="text-sm font-medium truncate">{chat.name}</p>
                  <p className="text-xs text-white/30 mt-0.5">
                    {new Date(chat.last_updated).toLocaleDateString()}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="p-6 border-t border-white/10">


        <div className="mt-6">
          <p className="text-white/20 text-xs text-center">
            Tovira v1.0.0
          </p>
        </div>
      </div>
    </div>
  );
}
