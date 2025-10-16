import { Outlet, useLocation } from 'react-router-dom';
import { Copy, Check, LogOut, MessageSquare, Users, Bell, Settings as SettingsIcon, Wallet, ArrowLeftRight, ArrowUp, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { Home } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

import { AuthProvider } from '@/components/auth/AuthProvider';
import { Sidebar } from '@/components/app/Sidebar';
import { BottomBar } from '@/components/app/BottomBar';
import { useAuth } from '@/hooks/useAuth';

const iconMap = {
  home: Home,
  settings: SettingsIcon,
  users: Users,
  messageSquare: MessageSquare,
  bell: Bell,
};

interface NavItem {
  name: string;
  to: string;
  icon: keyof typeof iconMap;
  active: boolean;
}

export default function AppLayout() {
  const location = useLocation();
  const { address, signOut } = useAuth();
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [isWalletCollapsed, setIsWalletCollapsed] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'Tokens' | 'Collectibles' | 'Activity'>('Tokens');

  const copyToClipboard = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const truncateAddress = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  const toggleWallet = () => {
    setIsWalletCollapsed(!isWalletCollapsed);
    setIsSettingsOpen(false); // Close settings if toggling wallet
  };

  const toggleSettings = () => {
    setIsSettingsOpen(!isSettingsOpen);
  };

  const navItems: NavItem[] = [
    {
      name: 'Chats',
      to: '/c/',
      icon: 'messageSquare',
      active: location.pathname === '/c' || location.pathname === '/app',
    },
    {
      name: 'Agents',
      to: '/agents',
      icon: 'users',
      active: location.pathname === '/app/agents',
    },
    {
      name: 'Notifications',
      to: '/notifications',
      icon: 'bell',
      active: location.pathname === '/app/notifications',
    },
    {
      name: 'Settings',
      to: '/app/settings',
      icon: 'settings',
      active: location.pathname === '/app/settings',
    },
  ];

  // Placeholder balance (replace with actual balance logic if available)
  const walletBalance = "0.00";

  return (
    <div className="relative bg-white/5 backdrop-blur-sm h-screen transition-all duration-500 overflow-hidden">
      <div
        className="absolute inset-0 bg-gradient-to-br from-transparent via-red-500 to-green-600 opacity-3 blur-xl -z-10"
      />

      <AuthProvider>
        <>
          {/* Desktop Layout */}
          <div className="hidden lg:flex h-screen p-0">
            <div className="flex w-full">
              {/* Sidebar */}
              <div className="p-4">
                <Sidebar navItems={navItems} onSignOut={signOut} />
              </div>

              {/* Main Content */}
              <div className="flex-1 flex flex-col overflow-hidden">
                <main className="flex-1 overflow-y-auto">
                  <Outlet />
                </main>
              </div>

              {/* Wallet Section */}
              <div className="p-4">

                <AnimatePresence mode="wait">
                  {isWalletCollapsed ? (
                    <motion.button
                      key="collapsed"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.3, ease: 'easeInOut' }}
                      onClick={toggleWallet}
                      className="h-fit p-4 bg-white/5 backdrop-blur-xl border border-white/10 rounded-[30px] cursor-pointer flex items-center gap-2 text-white/60 hover:text-white transition-colors"
                    >
                      <Wallet size={20} />
                      <span className="text-sm font-medium">{walletBalance}</span>
                    </motion.button>
                  ) : (
                    <motion.div
                      key="expanded"
                      initial={{ opacity: 0, right: -100 }}
                      animate={{ opacity: 1, right: 0 }}
                      exit={{ opacity: 0, right: -100 }}
                      transition={{ duration: 0.3, ease: 'easeInOut' }}
                      className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-[30px] w-80 h-full flex flex-col items-center relative p-6 mb-6"
                    >
                      {/* Header */}
                      <div className="flex justify-between items-center w-full mb-4">
                        <button
                          onClick={toggleSettings}
                          className="p-2 rounded-lg hover:bg-white/10 transition-colors"
                        >
                          <SettingsIcon size={20} className="text-white/60" />
                        </button>
                        <h2 className="font-bold text-xl">Wallet</h2>
                        <button
                          onClick={toggleWallet}
                          className="p-2 rounded-lg hover:bg-white/10 transition-colors"
                        >
                          <X size={20} className="text-white/60" />
                        </button>
                      </div>

                      {/* Connected Info */}
                      <div>
                        <div className="flex items-center justify-center text-center w-full gap-2">
                          <span className="text-[2.3rem] font-semibold">${walletBalance}</span>
                        </div>

                        <div className="flex items-center gap-3 w-full mb-6">
                          <div className="w-12 h-12 bg-gradient-to-r from-[#00FF88] to-[#00CC6A] rounded-xl flex items-center justify-center">
                            <span className="text-black font-bold text-sm">👤</span>
                          </div>
                          <div>
                            <h3 className="text-lg font-semibold text-white">Connected on Sui</h3>
                            <p className="text-white/60 text-sm">
                              {address ? truncateAddress(address) : 'No connection'}
                            </p>
                          </div>
                          <button
                            onClick={() => address && copyToClipboard(address, 'address')}
                            disabled={!address}
                            className={`ml-auto p-2 rounded-xl transition-all duration-200 flex items-center justify-center ${copiedField === 'address'
                              ? 'bg-green-500/20 text-green-400'
                              : 'text-white/60 hover:text-white hover:bg-white/10'
                              } ${!address ? 'opacity-50 cursor-not-allowed' : ''}`}
                          >
                            {copiedField === 'address' ? <Check size={18} /> : <Copy size={18} />}
                          </button>
                        </div>
                      </div>

                      {/* Action Buttons */}
                      <div className="grid grid-cols-3 gap-4 w-full text-[10px] font-bold mb-6">
                        <button className="flex flex-col items-center justify-center p-3 cursor-pointer w-full bg-white/5 rounded-[30px] hover:bg-white/10 transition-colors">
                          <div className="bg-white/60 rounded-full h-6 w-6 flex items-center justify-center">
                            <Plus size={18} className="text-[#000000]" />
                          </div>
                          <span className="">Deposit</span>
                        </button>
                        <button className="flex flex-col items-center justify-center p-3 cursor-pointer w-full bg-white/5 rounded-[30px] hover:bg-white/10 transition-colors">
                          <div className="bg-white/60 rounded-full h-6 w-6 flex items-center justify-center">
                            <ArrowLeftRight size={18} className="text-[#000000]" />
                          </div>
                          <span className="text-white/30">Swap</span>
                        </button>
                        <button className="flex flex-col items-center justify-center p-3 cursor-pointer w-full bg-white/5 rounded-[30px] hover:bg-white/10 transition-colors">
                          <div className="bg-white/60 rounded-full h-6 w-6 flex items-center justify-center">
                            <ArrowUp size={18} className="text-[#000000]" />
                          </div>
                          <span className="text-white/30">Send</span>
                        </button>
                      </div>

                      {/* Top Up Card */}
                      <div className="group relative bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-4 h-fit hover:border-white/20 hover:bg-white/10 transition-all duration-500 overflow-hidden">
                        <div className="flex justify-between items-center gap-3">
                          <div>
                            <h4 className="text-md font-semibold mb-1">Top Up Your Wallet</h4>
                            <p className="text-white/60 text-sm">Add funds quickly and securely</p>
                          </div>
                          <button className="p-2 bg-[#00FF88]/20 cursor-pointer rounded-lg hover:bg-[#00FF88]/30 transition-colors">
                            <Plus size={20} className="text-black" />
                          </button>
                        </div>
                      </div>

                      {/* Tabs Section */}
                      <div className="w-full mt-6">
                        <div className="flex justify-between border-b border-white/10 mb-4">
                          {(['Tokens', 'Collectibles', 'Activity'] as const).map((tab) => (
                            <button
                              key={tab}
                              onClick={() => setActiveTab(tab)}
                              className={`px-4 py-2 text-sm font-medium ${activeTab === tab
                                ? 'text-[#00FF88] border-b-2 border-[#00FF88]'
                                : 'text-white/60 hover:text-white'
                                } transition-colors`}
                            >
                              {tab}
                            </button>
                          ))}
                        </div>
                        <div className="p-4 bg-white/5 rounded-[30px] text-white/80">
                          {activeTab === 'Tokens' && (
                            <p className="text-sm">Your token balances will be displayed here.</p>
                          )}
                          {activeTab === 'Collectibles' && (
                            <p className="text-sm">Your NFTs and collectibles will be displayed here.</p>
                          )}
                          {activeTab === 'Activity' && (
                            <p className="text-sm">Your recent wallet transactions will be displayed here.</p>
                          )}
                        </div>
                      </div>

                      {/* Settings Overlay */}
                      {isSettingsOpen && (
                        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm rounded-2xl flex items-center justify-center z-10">
                          <div className="flex flex-col items-center gap-4">
                            <button
                              onClick={signOut}
                              className="flex items-center gap-2 bg-red-500/20 border border-red-500/30 text-red-300 hover:bg-red-500/30 transition-all duration-200 px-4 py-2 rounded-xl text-sm"
                            >
                              <LogOut className="w-4 h-4" />
                              <span>Disconnect</span>
                            </button>
                            <button
                              onClick={toggleSettings}
                              className="text-white/60 hover:text-white text-sm"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>

          {/* Mobile Layout */}
          <div className="lg:hidden flex flex-col h-screen">
            {/* Main Content */}
            <main className="flex-1 overflow-y-auto p-4">
              <Outlet />
            </main>

            {/* Bottom Bar */}
            <BottomBar navItems={navItems} onSignOut={signOut} />
          </div>
        </>
      </AuthProvider>
    </div>
  );
}