import { Link } from 'react-router-dom';
import { Home, Bell, User, Users, MessageSquare, Activity, Clock } from 'lucide-react';
import { useRef } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';

interface BottomNavProps {
  navItems: Array<{
    name: string;
    to: string;
    icon: keyof typeof iconMap;
    active: boolean;
  }>;
}

const iconMap = {
  home: Home,
  profile: User,
  users: Users,
  messageSquare: MessageSquare,
  bell: Bell,
  activity: Activity,
  clock: Clock,
};

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
            const Icon = iconMap[item.icon] || Home;
            return (
              <Link
                key={item.name}
                to={item.to}
                className={`flex flex-col items-center justify-center gap-1 px-4 py-2 rounded-xl transition-all duration-200 min-w-[64px] ${item.active
                  ? 'bg-gradient-to-r from-[#ffffff]/5 to-[#fdfdfd]/5 text-white'
                  : 'text-white/60 hover:text-white hover:bg-white/5'
                  }`}
              >
                <Icon
                  className={`flex-shrink-0 ${item.active ? 'text-[#00FF88]' : 'group-hover:text-[#00FF88]'
                    } transition-colors duration-200`}
                  size={20}
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
