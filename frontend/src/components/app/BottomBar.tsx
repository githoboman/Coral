// src/pages/app/components/app/BottomBar.tsx
import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LogOut } from 'lucide-react';

interface BottomBarProps {
  navItems: Array<{
    name: string;
    to: string;
    icon: string;
    active: boolean;
  }>;
  onSignOut: () => void;
}

export function BottomBar({ navItems, onSignOut }: BottomBarProps) {
  return (
    <div className="bg-gradient-to-t from-[#010103]/95 to-[#010103]/90 backdrop-blur-xl border-t border-white/10 px-4 py-2">
      <div className="flex items-center justify-between">
        {/* Navigation */}
        <div className="flex-1 flex justify-around">
          {navItems.slice(0, 3).map((item) => ( // Limit to 3 for mobile
            <Link
              key={item.name}
              to={item.to}
              className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-all duration-200 ${
                item.active
                  ? 'text-[#00FF88] bg-[#00FF88]/10'
                  : 'text-white/40 hover:text-white'
              }`}
            >
              <span className={`text-lg ${item.active ? 'text-[#00FF88]' : 'hover:text-[#00FF88]'}`}>
                {item.icon}
              </span>
              <span className="text-xs font-medium">{item.name}</span>
            </Link>
          ))}
        </div>
        
        {/* Sign Out */}
        <div className="flex items-center justify-center p-2">
          <button
            onClick={onSignOut}
            className="flex flex-col items-center gap-1 p-2 rounded-xl text-white/40 hover:text-red-400 hover:bg-red-500/10 transition-all duration-200"
          >
            <LogOut className="w-5 h-5" />
            <span className="text-xs">Out</span>
          </button>
        </div>
      </div>
    </div>
  );
}