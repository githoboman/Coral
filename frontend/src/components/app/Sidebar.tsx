import { Link } from 'react-router-dom';
import { Search, Home, Bell, Settings, Users, PanelLeftClose, PanelRightClose, MessageSquare } from 'lucide-react';
import { useState } from 'react';
import { motion } from 'framer-motion';

interface SidebarProps {
  navItems: Array<{
    name: string;
    to: string;
    icon: keyof typeof iconMap;
    active: boolean;
  }>;
  onSignOut: () => void;
}

const iconMap = {
  home: Home,
  settings: Settings,
  users: Users,
  messageSquare: MessageSquare,
  bell: Bell,
};

export function Sidebar({ navItems }: SidebarProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  const toggleSidebar = () => {
    setIsCollapsed(!isCollapsed);
  };

  return (
    <motion.div
      animate={{ width: isCollapsed ? 64 : 256, opacity: isCollapsed ? 0.8 : 1 }}
      transition={{ duration: 0.3, ease: 'easeInOut' }}
      className="h-full bg-gradient-to-b from-[#fdfdfd]/10 to-[#010103]/90 backdrop-blur-xl rounded-[30px] border border-white/10 flex flex-col"
    >
      {/* Logo/Brand */}
      <div className={`p-6 flex items-center ${isCollapsed ? "justify-center" : "justify-between"}`}>
        {!isCollapsed && (
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center">
              <img
                src="/assets/logo.png"
                alt="Logo"
                className="h-full w-full bg-cover"
              />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">
                Tovira
              </h1>
            </div>
          </div>
        )}
        <button
          onClick={toggleSidebar}
          className="p-2 rounded-lg hover:bg-white/10 transition-colors"
        >
          {isCollapsed ? <PanelRightClose size={20} className="text-white/60" /> : <PanelLeftClose size={20} className="text-white/60" />}
        </button>
      </div>

      {/* Search Through Chat section */}
      <div className={`px-4 ${isCollapsed ? 'hidden' : ''}`}>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-white/60" size={18} />
          <input
            type="text"
            placeholder="Search..."
            className="w-full pl-10 pr-4 py-2 bg-white/5 rounded-[30px] text-white/80 placeholder-white/40 border border-white/10 focus:outline-none focus:border-[#00FF88] transition-colors"
          />
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-6">
        <ul className="space-y-1 px-3">
          {navItems.map((item) => {
            const Icon = iconMap[item.icon] || Home;
            return (
              <li key={item.name}>
                <Link
                  to={item.to}
                  className={`group flex items-center px-3 py-3 rounded-xl transition-all duration-200 gap-3 ${isCollapsed && "justify-center"} ${
                    item.active
                      ? 'bg-gradient-to-r from-[#ffffff]/5 to-[#fdfdfd]/5 border border-[#ffffff]/10 text-white shadow-lg'
                      : 'text-white/60 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <Icon
                    className={`flex-shrink-0 ${
                      item.active ? 'text-[#00FF88]' : 'group-hover:text-[#00FF88]'
                    } transition-colors duration-200`}
                    size={20}
                  />
                  {!isCollapsed && <span className="text-sm font-medium">{item.name}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Footer */}
      <div className={`p-4 ${isCollapsed ? 'hidden' : ''}`}>
        <div className="mt-4 pt-4">
          <p className="text-white/30 text-xs text-center">
            Built on <span className="font-semibold text-[#00FF88]">Sui</span>
          </p>
        </div>
      </div>
    </motion.div>
  );
}