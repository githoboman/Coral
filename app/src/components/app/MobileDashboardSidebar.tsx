import { Link, useNavigate } from 'react-router-dom';
import { User, Layout } from 'lucide-react';

interface MobileDashboardSidebarProps {
  navItems: Array<{
    name: string;
    to: string;
    iconUrl: string;
    active: boolean;
  }>;
  onClose?: () => void;
}

export function MobileDashboardSidebar({ navItems, onClose }: MobileDashboardSidebarProps) {
  const navigate = useNavigate();


  /* Recents logic removed */

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
            return (
              <li key={item.name} className="relative">
                {/* Active Indicator (Lime Bar) */}
                {item.active && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[6px] h-3/5 bg-[#8BEE1C] rounded-r-md z-10" />
                )}

                <div className="px-3">
                  <Link
                    to={item.to}
                    onClick={onClose}
                    className={`group flex items-center px-5 py-4 rounded-[18px] transition-all duration-300 gap-5 cursor-pointer relative ${item.active
                      ? 'bg-[#1C1C1E] text-white'
                      : 'text-white/60 hover:text-white'
                      }`}
                  >
                    <img
                      src={item.iconUrl}
                      alt={item.name}
                      className={`flex-shrink-0 w-6 h-6 object-contain transition-opacity duration-200 ${item.active ? 'opacity-100' : 'opacity-50 group-hover:opacity-100'}`}
                    />
                    <div className="flex-1 flex items-center justify-between">
                      <span className="text-[20px] font-medium tracking-tight leading-none">{item.name}</span>
                    </div>
                  </Link>
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
