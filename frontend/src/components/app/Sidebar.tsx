// src/pages/app/components/appp/Sidebar.tsx
import React from 'react';
import { Link } from 'react-router-dom';
import { LogOut } from 'lucide-react';

interface SidebarProps {
  navItems: Array<{
    name: string;
    to: string;
    icon: string;
    active: boolean;
  }>;
  onSignOut: () => void;
}

export function Sidebar({ navItems, onSignOut }: SidebarProps) {
  return (
    <div className="w-64 bg-gradient-to-b from-[#010103]/95 to-[#010103]/90 backdrop-blur-xl border-r border-white/10 flex flex-col">
      {/* Logo/Brand */}
      <div className="p-6 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-15 h-15 bg-gradient-to-r from-transparent to-[#00103] backdrop-blur-md rounded-xl flex items-center justify-center">
            <img
              src="/assets/logo.png"
              alt="Logo"
              className=" h-full w-full bg-cover"
            />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">
              Tovira
            </h1>
            <p className="text-white/40 text-xs">AI Task Manager on Sui</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-6">
        <ul className="space-y-1 px-3">
          {navItems.map((item) => (
            <li key={item.name}>
              <Link
                to={item.to}
                className={`group flex items-center px-3 py-3 rounded-xl transition-all duration-200 ${item.active
                    ? 'bg-gradient-to-r from-[#00FF88]/20 to-[#00CC6A]/20 border border-[#00FF88]/30 text-white shadow-lg'
                    : 'text-white/60 hover:text-white hover:bg-white/5'
                  }`}
              >
                <span className={`mr-3 text-lg flex-shrink-0 ${item.active ? 'text-[#00FF88]' : 'group-hover:text-[#00FF88]'} transition-colors duration-200`}>
                  {item.icon}
                </span>
                <span className="text-sm font-medium">{item.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-white/10">
        <button
          onClick={onSignOut}
          className="w-full flex items-center gap-3 px-3 py-3 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-all duration-200 text-white/70 hover:text-white"
        >
          <LogOut className="w-4 h-4" />
          <span className="text-sm font-medium">Sign Out</span>
        </button>

        <div className="mt-4 pt-4 border-t border-white/10">
          <p className="text-white/30 text-xs text-center">
            Built on <span className="font-semibold text-[#00FF88]">Sui</span>
          </p>
        </div>
      </div>
    </div>
  );
}