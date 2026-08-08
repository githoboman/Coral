import { Link } from 'react-router-dom';
import { Home, Bell, Settings, Users, MessageSquare, LogOut } from 'lucide-react';
import { motion } from 'framer-motion';

interface BottomBarProps {
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

export function BottomBar({ navItems, onSignOut }: BottomBarProps) {
  return (
    <motion.div
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.3, ease: 'easeInOut' }}
      className="bg-gradient-to-t from-[#fdfdfd]/10 to-[#010103]/90 backdrop-blur-xl border-t border-white/10 px-4 py-3 rounded-t-[30px]"
    >
      <div className="flex items-center justify-between">
        {/* Navigation */}
        <div className="flex-1 flex justify-around">
          {navItems.slice(0, 3).map((item) => {
            const Icon = iconMap[item.icon] || Home;
            return (
              <Link
                key={item.name}
                to={item.to}
                className={`group flex flex-col items-center gap-1 p-3 rounded-xl transition-all duration-200 ${
                  item.active
                    ? 'text-white shadow-lg'
                    : 'text-white/60 hover:text-white hover:bg-white/5'
                }`}
              >
                <Icon
                  className={`w-5 h-5 ${
                    item.active ? 'text-[#00FF88]' : 'group-hover:text-[#00FF88]'
                  } transition-colors duration-200`}
                />
                <span className="text-xs font-medium">{item.name}</span>
              </Link>
            );
          })}
        </div>

        {/* Sign Out */}
        <div className="flex items-center justify-center">
          <button
            onClick={onSignOut}
            className="flex flex-col items-center gap-1 p-2 rounded-lg text-white/60 hover:text-red-400 hover:bg-red-500/10 transition-all duration-200"
          >
            <LogOut className="w-5 h-5" />
            <span className="text-xs font-medium">Out</span>
          </button>
        </div>
      </div>
    </motion.div>
  );
}