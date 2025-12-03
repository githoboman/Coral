import { Outlet, useLocation } from 'react-router-dom';
import {
  Copy, Check, LogOut, MessageSquare, Users, User, Bell,
  Settings as SettingsIcon, Wallet,
  Plus, X, Home,
} from 'lucide-react';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { AuthProvider } from '@/components/auth/AuthProvider';
import { Sidebar } from '@/components/app/Sidebar';
import { useAuth } from '@/hooks/useAuth';

const debounce = (func: (...args: any[]) => void, wait: number) => {
  let timeout: NodeJS.Timeout;
  return (...args: any[]) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
};

const iconMap = {
  home: Home,
  profile: User,
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
  const [walletBalanceUSD, setWalletBalanceUSD] = useState<string>('0.00');
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<number | null>(null);

  const suiClient = useMemo(() => new SuiClient({
    url: getFullnodeUrl('mainnet'),
  }), []);

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
    setIsWalletCollapsed((prev) => !prev);
    setIsSettingsOpen(false);
  };
  const toggleSettings = () => setIsSettingsOpen((prev) => !prev);

  const fetchSuiPriceUSD = useCallback(async (): Promise<number> => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(
        'https://api.coingecko.com/api/v3/simple/price?ids=sui&vs_currencies=usd',
        { signal: controller.signal }
      );
      clearTimeout(timeoutId);
      const data = await res.json();
      return data.sui?.usd || 1.85;
    } catch {
      return 1.85;
    }
  }, []);

  const fetchBalance = useCallback(async () => {
    if (!address) {
      setWalletBalanceUSD('0.00');
      setError(null);
      setLastFetched(null);
      setBalanceLoading(false);
      return;
    }

    const now = Date.now();
    if (lastFetched && now - lastFetched < 30_000) return;

    setBalanceLoading(true);
    setError(null);

    try {
      const coins = await suiClient.getAllBalances({ owner: address });
      const totalBalanceMIST = coins.reduce((sum, c) => sum + Number(c.totalBalance), 0);
      const suiBalance = totalBalanceMIST / 1_000_000_000;
      const suiPriceUSD = await fetchSuiPriceUSD();
      const usd = (suiBalance * suiPriceUSD).toFixed(2);

      setWalletBalanceUSD(usd);
      setLastFetched(now);
      setError(null);
    } catch (err: any) {
      console.error('Balance fetch failed:', err);
      setError('Failed to fetch wallet balance.');
      setWalletBalanceUSD('0.00');
      setLastFetched(null);
    } finally {
      setBalanceLoading(false);
    }
  }, [address, lastFetched, suiClient, fetchSuiPriceUSD]);

  const debouncedFetchBalance = useMemo(() => debounce(fetchBalance, 500), [fetchBalance]);

  useEffect(() => {
    if (address) {
      debouncedFetchBalance();
      const interval = setInterval(fetchBalance, 60_000);
      return () => clearInterval(interval);
    } else {
      setWalletBalanceUSD('0.00');
      setError(null);
      setLastFetched(null);
      setBalanceLoading(false);
    }
  }, [address, debouncedFetchBalance, fetchBalance]);

  const navItems: NavItem[] = [
    { name: 'Chats', to: '/', icon: 'messageSquare', active: location.pathname === '/c' || location.pathname === '/app' },
    { name: 'Agents', to: '/agents', icon: 'users', active: location.pathname === '/agents' },
    { name: 'Activity', to: '/activity', icon: 'bell', active: location.pathname === '/activity' },
    { name: 'Account', to: '/account', icon: 'profile', active: location.pathname === '/account' },
  ];

  return (
    <div className="w-full relative bg-white/5 backdrop-blur-sm transition-all duration-500 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-transparent via-red-500 to-green-600 opacity-3 blur-xl -z-10" />

      <AuthProvider>
        <div className="flex w-full h-dvh overflow-y-auto">
          <div className="sticky top-0 p-4">
            <Sidebar navItems={navItems} onSignOut={signOut} />
          </div>

          <div className="h-fit flex-1">
            <Outlet />
          </div>

          {/* Wallet Section */}
          <div className="sticky top-0 p-4">
            <AnimatePresence mode="wait">
              {isWalletCollapsed ? (
                <motion.button
                  key="collapsed"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3 }}
                  onClick={toggleWallet}
                  className="fixed top-0 right-0 cursor-pointer z-[100] m-4 h-fit p-4 bg-[#2D2D2D] backdrop-blur-xl border border-white/10 rounded-[30px] flex items-center gap-2 text-white/60 hover:text-white transition-colors"
                >
                  <Wallet size={20} onClick={toggleWallet} className="cursor-pointer" />
                  <span onClick={toggleWallet} className="cursor-pointer text-sm font-medium">
                    {balanceLoading ? 'Loading...' : `$${walletBalanceUSD}`}
                  </span>
                </motion.button>
              ) : (
                <motion.div
                  key="expanded"
                  initial={{ opacity: 0, right: -100 }}
                  animate={{ opacity: 1, right: 0 }}
                  exit={{ opacity: 0, right: -100 }}
                  transition={{ duration: 0.3 }}
                  className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-[30px] w-80 h-full flex flex-col items-center relative p-6 mb-6"
                >
                  <div className="flex justify-between items-center w-full mb-4">
                    <button onClick={toggleSettings} className="p-2 rounded-lg hover:bg-white/10">
                      <SettingsIcon size={20} className="text-white/60" />
                    </button>
                    <h2 className="font-bold text-xl">Wallet</h2>
                    <button onClick={toggleWallet} className="p-2 rounded-lg hover:bg-white/10">
                      <X size={20} className="text-white/60" />
                    </button>
                  </div>

                  <div className="flex flex-col items-center justify-center text-center w-full">
                    <span className="text-[2.3rem] font-semibold">
                      {balanceLoading ? 'Loading...' : `$${walletBalanceUSD}`}
                    </span>
                    {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
                    {lastFetched && !error && (
                      <p className="text-white/60 text-xs mt-2">
                        Updated {new Date(lastFetched).toLocaleTimeString('en-US', { timeZone: 'Africa/Lagos' })}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-3 w-full my-6">
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

                  <div className="w-full mt-6">
                    <div className="flex justify-between border-b border-white/10 mb-4">
                      {(['Tokens', 'Collectibles', 'Activity'] as const).map((tab) => (
                        <button
                          key={tab}
                          onClick={() => setActiveTab(tab)}
                          className={`px-4 py-2 text-sm font-medium ${activeTab === tab
                            ? 'text-[#00FF88] border-b-2 border-[#00FF88]'
                            : 'text-white/60 hover:text-white'
                            }`}
                        >
                          {tab}
                        </button>
                      ))}
                    </div>
                    <div className="p-4 bg-white/5 rounded-[30px] text-white/80">
                      {activeTab === 'Tokens' && <p className="text-sm">Your token balances will be displayed here.</p>}
                      {activeTab === 'Collectibles' && <p className="text-sm">Your NFTs and collectibles will be displayed here.</p>}
                      {activeTab === 'Activity' && <p className="text-sm">Your recent wallet transactions will be displayed here.</p>}
                    </div>
                  </div>

                  {isSettingsOpen && (
                    <div className="absolute inset-0 bg-black/80 backdrop-blur-sm rounded-2xl flex items-center justify-center z-10">
                      <div className="flex flex-col items-center gap-4">
                        <button
                          onClick={signOut}
                          className="flex items-center gap-2 bg-red-500/20 border border-red-500/30 text-red-300 hover:bg-red-500/30 px-4 py-2 rounded-xl text-sm"
                        >
                          <LogOut className="w-4 h-4" />
                          <span>Disconnect</span>
                        </button>
                        <button onClick={toggleSettings} className="text-white/60 hover:text-white text-sm">
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
      </AuthProvider>
    </div>
  );
}
