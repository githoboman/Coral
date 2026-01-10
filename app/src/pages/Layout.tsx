import { Outlet, useLocation } from 'react-router-dom';
import {
  Copy, Check, MessageSquare, Users, User, Bell,
  Settings as SettingsIcon, Wallet,
  Plus, X, Home, Activity, ChevronRight, Send,
  RefreshCcw, ArrowUp, ChevronDown,
  Key, Fingerprint, Mail, Twitter, Gamepad2,
} from 'lucide-react';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { useDisconnectWallet, useCurrentAccount } from '@mysten/dapp-kit';
import { Sidebar } from '@/components/app/Sidebar';
import { MobileDashboardSidebar } from '@/components/app/MobileDashboardSidebar';
import { BottomNav } from '@/components/app/BottomNav';
import { MobileTopBar } from '@/components/app/MobileTopBar';
import { AutoCheckIn } from '@/components/features/CheckInButton';
import { toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

export type LayoutContextType = {
  toggleWallet: () => void;
  walletBalanceUSD: string;
};

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
  activity: Activity,
};

interface NavItem {
  name: string;
  to: string;
  icon: keyof typeof iconMap;
  active: boolean;
}

export default function AppLayout() {
  const location = useLocation();
  const currentAccount = useCurrentAccount();
  const { mutate: disconnect } = useDisconnectWallet();

  // Use address from dApp Kit wallet
  const address = currentAccount?.address || null;

  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [isWalletCollapsed, setIsWalletCollapsed] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeSubmenu, setActiveSubmenu] = useState<'favorites' | null>(null);

  const [activeWalletModal, setActiveWalletModal] = useState<'deposit' | 'send' | 'swap' | null>(null);
  const [activeTab, setActiveTab] = useState<'Tokens' | 'Collectibles' | 'Activity'>('Tokens');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // logic for dashboard check - treats root and dynamic chat IDs as dashboard
  const isDashboard = !['/activity', '/account', '/onchain'].some(path => location.pathname.startsWith(path));

  // Close sidebar on route change
  useEffect(() => {
    setIsSidebarOpen(false);
  }, [location.pathname]);

  const [walletBalanceUSD, setWalletBalanceUSD] = useState<string>('0.00');

  const [lastFetched, setLastFetched] = useState<number | null>(null);

  // Tab Data States
  const [tokens, setTokens] = useState<any[]>([]);
  const [nfts, setNfts] = useState<any[]>([]);
  const [activity, setActivity] = useState<any[]>([]);

  // Send Form State
  const [sendRecipient, setSendRecipient] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [selectedSendToken, setSelectedSendToken] = useState<any>(null);
  const [isSending, setIsSending] = useState(false);

  // Swap Form State
  const [swapFromToken, setSwapFromToken] = useState<any>(null);
  const [swapToToken, setSwapToToken] = useState<any>(null);
  const [swapFromAmount, setSwapFromAmount] = useState('');
  const [swapToAmount, setSwapToAmount] = useState('');
  const [isSwapping, setIsSwapping] = useState(false);
  const swapRate = 1.85; // Mock rate for now

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
      setLastFetched(null);
      return;
    }

    const now = Date.now();
    if (lastFetched && now - lastFetched < 30_000) return;

    try {

      // 1. Fetch Balances (Coins)
      const coins = await suiClient.getAllBalances({ owner: address });

      // Calculate Total USD & Build Token List
      const suiPriceUSD = await fetchSuiPriceUSD();
      let totalUsd = 0;
      const tokenList: any[] = [];
      const KNOWN_TOKENS = {
        '0x2::sui::SUI': { symbol: 'SUI', decimals: 9, price: suiPriceUSD, icon: 'S' },
        '0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN': { symbol: 'USDC', decimals: 6, price: 1.0, icon: '$' }, // Example USDC
        '0xc060006111016b8a020ad5b3383498414374b0f23a5416f554492723::coin::COIN': { symbol: 'USDT', decimals: 6, price: 1.0, icon: 'T' }
      };

      // Process owned coins
      for (const coin of coins) {
        const type = coin.coinType;
        const meta = KNOWN_TOKENS[type as keyof typeof KNOWN_TOKENS] || { symbol: 'UNK', decimals: 9, price: 0, icon: '?' };
        const balance = Number(coin.totalBalance) / Math.pow(10, meta.decimals);
        const value = balance * meta.price;
        if (type.includes('sui::SUI') || value > 0.01) { // Filter dust
          totalUsd += value;
          tokenList.push({ ...meta, balance, value, type });
        }
      }

      // Ensure SUI and USDC appear even if empty
      if (!tokenList.find(t => t.symbol === 'SUI')) tokenList.unshift({ symbol: 'SUI', decimals: 9, price: suiPriceUSD, balance: 0, value: 0, icon: 'S' });
      if (!tokenList.find(t => t.symbol === 'USDC')) tokenList.push({ symbol: 'USDC', decimals: 6, price: 1, balance: 0, value: 0, icon: '$' });

      setWalletBalanceUSD(totalUsd.toFixed(2));
      setTokens(tokenList.sort((a, b) => b.value - a.value));

      // 2. Fetch NFTs (Objects that aren't coins)
      const objects = await suiClient.getOwnedObjects({
        owner: address,
        options: { showType: true, showDisplay: true, showContent: true }
      });
      const nftList = objects.data
        .filter(obj => obj.data?.display?.data || (obj.data?.type && !obj.data.type.startsWith('0x2::coin::Coin')))
        .map(obj => ({
          id: obj.data?.objectId,
          type: obj.data?.type,
          name: obj.data?.display?.data?.name || 'Unknown NFT',
          image: obj.data?.display?.data?.image_url,
          description: obj.data?.display?.data?.description
        }));
      setNfts(nftList);

      // 3. Fetch Recent Activity
      const txs = await suiClient.queryTransactionBlocks({
        filter: { FromAddress: address },
        limit: 10,
        order: 'descending',
        options: { showEffects: true, showInput: true, showBalanceChanges: true }
      });
      setActivity(txs.data);

      setLastFetched(now);
    } catch (err: any) {
      console.error('Balance fetch failed:', err);
      setWalletBalanceUSD('0.00');
      setLastFetched(null);
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
      setLastFetched(null);
    }
  }, [address, debouncedFetchBalance, fetchBalance]);

  // Initialize default tokens on modal open
  useEffect(() => {
    if (activeWalletModal === 'send' && !selectedSendToken && tokens.length > 0) {
      const suiToken = tokens.find(t => t.symbol === 'SUI');
      setSelectedSendToken(suiToken || tokens[0]);
    }
    if (activeWalletModal === 'swap') {
      if (!swapFromToken && tokens.length > 0) {
        const suiToken = tokens.find(t => t.symbol === 'SUI');
        setSwapFromToken(suiToken || tokens[0]);
      }
      if (!swapToToken && tokens.length > 0) {
        const usdcToken = tokens.find(t => t.symbol === 'USDC');
        setSwapToToken(usdcToken || tokens[1]);
      }
    }
  }, [activeWalletModal, tokens, selectedSendToken, swapFromToken, swapToToken]);

  // Update swap output amount when input changes
  useEffect(() => {
    if (swapFromAmount && !isNaN(parseFloat(swapFromAmount))) {
      const outputAmount = (parseFloat(swapFromAmount) * swapRate).toFixed(6);
      setSwapToAmount(outputAmount);
    } else {
      setSwapToAmount('');
    }
  }, [swapFromAmount, swapRate]);

  const handleSend = async () => {
    if (!address || !sendRecipient || !sendAmount || !selectedSendToken) {
      toast.error('Please fill in all fields', { theme: 'dark' });
      return;
    }

    // Validate recipient address
    if (!sendRecipient.startsWith('0x') || sendRecipient.length !== 66) {
      toast.error('Invalid recipient address', { theme: 'dark' });
      return;
    }

    const amount = parseFloat(sendAmount);
    if (isNaN(amount) || amount <= 0) {
      toast.error('Invalid amount', { theme: 'dark' });
      return;
    }

    // Check balance
    if (amount > selectedSendToken.balance) {
      toast.error('Insufficient balance', { theme: 'dark' });
      return;
    }

    setIsSending(true);

    try {
      // Convert amount to smallest unit
      const amountInSmallestUnit = Math.floor(amount * Math.pow(10, selectedSendToken.decimals));

      // Build transaction
      const tx = new Transaction();

      if (selectedSendToken.symbol === 'SUI') {
        // For SUI, use splitCoins and transferObjects
        const [coin] = tx.splitCoins(tx.gas, [amountInSmallestUnit]);
        tx.transferObjects([coin], sendRecipient);
      } else {
        // For other tokens, we need to find and split coins
        const coins = await suiClient.getCoins({
          owner: address,
          coinType: selectedSendToken.type,
        });

        if (coins.data.length === 0) {
          throw new Error('No coins found for this token');
        }

        // Use the first coin and split if needed
        const coinToUse = coins.data[0];
        const [splitCoin] = tx.splitCoins(tx.object(coinToUse.coinObjectId), [amountInSmallestUnit]);
        tx.transferObjects([splitCoin], sendRecipient);
      }

      tx.setSender(address);

      // Transaction signing with Enoki wallet
      // Note: This requires using the useSignAndExecuteTransaction hook
      // For now, show a message that transaction support is coming
      throw new Error('Transaction signing is being implemented. This feature will be available soon.');
    } catch (error: any) {
      console.error('Send error:', error);
      toast.error(error.message || 'Failed to send transaction', { theme: 'dark' });
    } finally {
      setIsSending(false);
    }
  };

  const handleSwap = async () => {
    if (!address || !swapFromAmount || !swapFromToken || !swapToToken) {
      toast.error('Please fill in all fields', { theme: 'dark' });
      return;
    }

    const amount = parseFloat(swapFromAmount);
    if (isNaN(amount) || amount <= 0) {
      toast.error('Invalid amount', { theme: 'dark' });
      return;
    }

    if (amount > swapFromToken.balance) {
      toast.error('Insufficient balance', { theme: 'dark' });
      return;
    }

    if (swapFromToken.symbol === swapToToken.symbol) {
      toast.error('Cannot swap same token', { theme: 'dark' });
      return;
    }

    setIsSwapping(true);

    try {
      // TODO: Integrate with actual DEX (Cetus, Turbos, etc.)
      // For now, this is a placeholder that shows the flow

      toast.info('Swap functionality coming soon! Will integrate with Cetus DEX.', {
        theme: 'dark',
        autoClose: 3000
      });

      // Simulated delay
      await new Promise(resolve => setTimeout(resolve, 2000));

      // In production, you would:
      // 1. Get swap route from DEX aggregator
      // 2. Build swap transaction
      // 3. Sign and execute
      // 4. Update balances

      /* Example structure:
      const keypair = getKeypair();
      if (!keypair) throw new Error('Wallet not connected');

      const tx = new Transaction();
      // Add DEX swap logic here
      
      const txBytes = await tx.build({ client: suiClient });
      const { signature } = await keypair.signTransaction(txBytes);
      
      const result = await suiClient.executeTransactionBlock({
        transactionBlock: txBytes,
        signature,
        options: { showEffects: true },
      });
      */

    } catch (error: any) {
      console.error('Swap error:', error);
      toast.error(error.message || 'Failed to swap', { theme: 'dark' });
    } finally {
      setIsSwapping(false);
    }
  };

  const navItems: NavItem[] = [
    { name: 'Chats', to: '/', icon: 'messageSquare', active: location.pathname === '/c' || location.pathname === '/app' },
    { name: 'Analytics', to: '/onchain', icon: 'activity', active: location.pathname === '/onchain' },
    { name: 'Activity', to: '/activity', icon: 'bell', active: location.pathname === '/activity' },
    { name: 'Account', to: '/account', icon: 'profile', active: location.pathname === '/account' },
  ];

  return (
    <div className="w-full relative bg-white/5 backdrop-blur-sm transition-all duration-500 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-transparent via-red-500 to-green-600 opacity-3 blur-xl -z-10" />

      <div className="flex w-full h-dvh overflow-x-hidden overflow-y-auto">
        {/* Sidebar */}
        <div className="sticky top-0 p-4 hidden md:flex">
          <Sidebar navItems={navItems} onSignOut={() => disconnect()} />
        </div>

        {/* Main Content */}
        <div className={`h-fit w-full flex-1 ${!isDashboard ? 'pb-20' : ''} md:pb-0`}>
          <MobileTopBar
            balance={walletBalanceUSD}
            onWalletClick={!isDashboard ? () => setIsWalletCollapsed(false) : undefined}
            onMenuClick={isDashboard ? () => setIsSidebarOpen(true) : undefined}
          />
          <Outlet context={{ toggleWallet: () => setIsWalletCollapsed((prev: boolean) => !prev), walletBalanceUSD } satisfies LayoutContextType} />
        </div>

        {/* Mobile Sidebar Drawer */}
        <AnimatePresence>
          {isSidebarOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 bg-black/60 z-[70] md:hidden backdrop-blur-sm"
                onClick={() => setIsSidebarOpen(false)}
              />
              <motion.div
                initial={{ x: '-100%' }}
                animate={{ x: 0 }}
                exit={{ x: '-100%' }}
                transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                className="fixed inset-y-0 left-0 w-64 bg-[#18181B] z-[80] p-4 border-r border-white/10 md:hidden overflow-y-auto"
              >
                {isDashboard ? (
                  <MobileDashboardSidebar
                    navItems={navItems}
                    onClose={() => setIsSidebarOpen(false)}
                  />
                ) : (
                  <Sidebar navItems={navItems} onSignOut={() => disconnect()} />
                )}
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* Wallet Section */}
        <div className={`p-0 md:p-4 md:sticky top-0 ${!isWalletCollapsed ? 'fixed inset-0 z-[100] w-full md:w-fit h-[100dvh] flex flex-col justify-end bg-[#18181B] md:bg-transparent md:backdrop-blur-none md:block' : 'hidden md:block'}`}>
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
                <Wallet size={20} className="cursor-pointer" />
                <span className="cursor-pointer text-sm font-medium">
                  {`$${walletBalanceUSD}`}
                </span>
              </motion.button>
            ) : (
              <motion.div
                key="expanded"
                initial={{ opacity: 0, x: '100%' }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: '100%' }}
                transition={{ duration: 0.3, ease: 'easeInOut' }}
                className="bg-[#18181B] md:bg-white/5 backdrop-blur-xl border-0 md:border md:border-white/10 rounded-none md:rounded-[30px] w-full md:w-80 h-full flex flex-col items-center relative p-6 mb-0 md:mb-6 overflow-hidden shadow-none md:shadow-none"
              >
                <div className="flex justify-between items-center w-full mb-8">
                  <button onClick={toggleSettings} className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors">
                    <SettingsIcon size={20} className="text-white" />
                  </button>
                  <div className="flex items-center gap-2 cursor-pointer hover:bg-white/5 px-3 py-1.5 rounded-full transition-colors">
                    <span className="font-bold text-white">Main Account</span>
                    <ChevronDown size={16} className="text-white/60" />
                  </div>
                  <button onClick={toggleWallet} className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors">
                    <X size={20} className="text-white" />
                  </button>
                </div>

                <div className="flex flex-col items-center justify-center text-center w-full mb-8">
                  <span className="text-[2.5rem] font-bold text-white tracking-tight">
                    {`$${walletBalanceUSD}`}
                  </span>
                  <button
                    onClick={() => address && copyToClipboard(address, 'address')}
                    className="flex items-center gap-1 text-white/60 hover:text-white transition-colors mt-1"
                  >
                    <span className="text-sm">Addresses</span>
                    <ChevronRight size={14} />
                  </button>
                  {copiedField === 'address' && <span className="text-xs text-green-400 absolute mt-16">Address Copied!</span>}
                </div>

                {/* Actions Row */}
                <div className="flex items-center justify-center gap-6 w-full mb-8">
                  <div className="flex flex-col items-center gap-2 group cursor-pointer" onClick={() => setActiveWalletModal('deposit')}>
                    <div className="w-14 h-14 rounded-full bg-white/5 group-hover:bg-white/10 flex items-center justify-center transition-colors border border-white/5">
                      <Plus size={24} className="text-white" />
                    </div>
                    <span className="text-xs font-medium text-white/80">Deposit</span>
                  </div>
                  <div className="flex flex-col items-center gap-2 group cursor-pointer" onClick={() => setActiveWalletModal('swap')}>
                    <div className="w-14 h-14 rounded-full bg-white/5 group-hover:bg-white/10 flex items-center justify-center transition-colors border border-white/5">
                      <RefreshCcw size={20} className="text-white/60 group-hover:text-white transition-colors" />
                    </div>
                    <span className="text-xs font-medium text-white/40 group-hover:text-white/80 transition-colors">Swap</span>
                  </div>
                  <div className="flex flex-col items-center gap-2 group cursor-pointer" onClick={() => setActiveWalletModal('send')}>
                    <div className="w-14 h-14 rounded-full bg-white/5 group-hover:bg-white/10 flex items-center justify-center transition-colors border border-white/5">
                      <ArrowUp size={24} className="text-white/60 group-hover:text-white transition-colors" />
                    </div>
                    <span className="text-xs font-medium text-white/40 group-hover:text-white/80 transition-colors">Send</span>
                  </div>
                </div>

                {/* Wallet Action Modals */}
                <AnimatePresence>
                  {activeWalletModal && (
                    <div className="absolute inset-0 z-50 bg-[#18181B] flex flex-col items-center p-6 animate-in fade-in zoom-in duration-200">
                      {/* Shared Header */}
                      <div className="w-full flex items-center mb-6">
                        <button
                          onClick={(e) => { e.stopPropagation(); setActiveWalletModal(null); }}
                          className="p-2 -ml-2 rounded-full hover:bg-white/5 transition-colors"
                        >
                          <ChevronRight size={24} className="text-white rotate-180" />
                        </button>
                        <span className="text-lg font-bold text-white ml-2 capitalize">{activeWalletModal === 'deposit' ? 'Your Sui Address' : activeWalletModal}</span>
                      </div>

                      {/* CONTENT: DEPOSIT */}
                      {activeWalletModal === 'deposit' && (
                        <>
                          <div className="flex-1 flex flex-col items-center justify-center w-full -mt-10">
                            <div className="bg-white p-4 rounded-[24px] mb-8 relative">
                              <img
                                src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${address || ''}`}
                                alt="Wallet QR"
                                className="w-48 h-48"
                              />
                              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center shadow-md">
                                  <img src="https://cryptologos.cc/logos/sui-sui-logo.png?v=029" alt="Sui" className="w-6 h-6 object-contain" />
                                </div>
                              </div>
                            </div>
                            <h3 className="text-xl font-bold text-white mb-2">Your Sui Address</h3>
                            <p className="text-[#A1A1AA] text-sm text-center max-w-[260px] leading-relaxed">
                              Use this address to receive tokens and collectibles on <span className="text-white font-medium">Sui Network</span>.
                            </p>
                          </div>
                          <div className="mt-auto w-full space-y-3">
                            <button
                              onClick={() => address && copyToClipboard(address, 'modal-addr')}
                              className="w-full h-14 bg-[#27272A] rounded-xl flex items-center justify-between px-4 hover:bg-[#3F3F46] transition-colors active:scale-[0.98]"
                            >
                              <span className="font-mono text-white/90 truncate mr-4 text-[15px]">
                                {address ? `${address.slice(0, 20)}...${address.slice(-4)}` : ''}
                              </span>
                              {copiedField === 'modal-addr' ? <Check size={18} className="text-[#00FF88]" /> : <Copy size={18} className="text-[#A1A1AA]" />}
                            </button>
                            <button
                              onClick={async () => {
                                if (navigator.share && address) {
                                  try { await navigator.share({ title: 'My Sui Address', text: address }); } catch (err) { }
                                } else { setActiveWalletModal(null); }
                              }}
                              className="w-full h-14 bg-[#00FF88] text-black font-bold text-[16px] rounded-xl hover:bg-[#00CC6A] transition-colors active:scale-[0.98] flex items-center justify-center"
                            >
                              Share
                            </button>
                          </div>
                        </>
                      )}

                      {/* CONTENT: SEND */}
                      {activeWalletModal === 'send' && (
                        <div className="w-full h-full flex flex-col">
                          <div className="space-y-4 flex-1">
                            <div>
                              <label className="text-xs font-bold text-white/40 uppercase ml-1 mb-1.5 block">Recipient Address</label>
                              <div className="flex items-center gap-2 bg-[#27272A] rounded-xl px-4 py-3 border border-white/5 focus-within:border-[#00FF88]/50 transition-colors">
                                <input
                                  placeholder="0x..."
                                  value={sendRecipient}
                                  onChange={(e) => setSendRecipient(e.target.value)}
                                  className="bg-transparent w-full text-white placeholder-white/20 outline-none font-mono text-sm"
                                />
                                <button className="p-1 hover:bg-white/10 rounded-md"><Users size={16} className="text-white/40" /></button>
                              </div>
                            </div>

                            <div>
                              <label className="text-xs font-bold text-white/40 uppercase ml-1 mb-1.5 block">Asset & Amount</label>
                              <div className="bg-[#27272A] rounded-xl p-4 border border-white/5 space-y-4">
                                <div className="flex items-center justify-between">
                                  <input
                                    placeholder="0.00"
                                    type="number"
                                    value={sendAmount}
                                    onChange={(e) => setSendAmount(e.target.value)}
                                    className="bg-transparent w-full text-3xl font-bold text-white placeholder-white/20 outline-none"
                                  />
                                  <button className="flex items-center gap-2 bg-black/40 hover:bg-black/60 px-3 py-1.5 rounded-full transition-colors border border-white/10">
                                    <div className="w-5 h-5 bg-[#2D9CDB] rounded-full flex items-center justify-center text-[10px] font-bold">{selectedSendToken?.icon || 'S'}</div>
                                    <span className="font-bold text-white text-sm">{selectedSendToken?.symbol || 'SUI'}</span>
                                    <ChevronDown size={14} className="text-white/60" />
                                  </button>
                                </div>
                                <div className="flex justify-between items-center text-xs">
                                  <span className="text-white/40">Balance: {selectedSendToken?.balance?.toFixed(4) || '0.00'} {selectedSendToken?.symbol || 'SUI'}</span>
                                  <button
                                    onClick={() => selectedSendToken && setSendAmount(selectedSendToken.balance.toString())}
                                    className="text-[#00FF88] font-bold hover:underline"
                                  >
                                    MAX
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>

                          <button
                            onClick={handleSend}
                            disabled={isSending || !sendRecipient || !sendAmount}
                            className="w-full h-14 bg-[#00FF88] text-black font-bold text-[16px] rounded-xl hover:bg-[#00CC6A] transition-colors active:scale-[0.98] mt-4 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {isSending ? (
                              <>
                                <RefreshCcw size={18} className="animate-spin" />
                                Sending...
                              </>
                            ) : (
                              <>
                                <Send size={18} />
                                Send Tokens
                              </>
                            )}
                          </button>
                        </div>
                      )}

                      {/* CONTENT: SWAP */}
                      {activeWalletModal === 'swap' && (
                        <div className="w-full h-full flex flex-col relative">
                          <div className="space-y-2 flex-1 pt-4">
                            {/* From Token */}
                            <div className="bg-[#27272A] rounded-2xl p-4 border border-white/5 relative z-10">
                              <div className="flex justify-between mb-2">
                                <span className="text-xs font-bold text-white/40 uppercase">You Pay</span>
                                <span className="text-xs text-white/40">Balance: {swapFromToken?.balance?.toFixed(4) || '0.00'}</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <input
                                  placeholder="0"
                                  value={swapFromAmount}
                                  onChange={(e) => setSwapFromAmount(e.target.value)}
                                  type="number"
                                  className="bg-transparent text-3xl font-bold text-white placeholder-white/20 outline-none w-1/2"
                                />
                                <button className="flex items-center gap-2 bg-black/40 hover:bg-black/60 px-3 py-1.5 rounded-full transition-colors border border-white/10">
                                  <div className="w-6 h-6 bg-[#2D9CDB] rounded-full flex items-center justify-center text-[10px] font-bold">{swapFromToken?.icon || 'S'}</div>
                                  <span className="font-bold text-white">{swapFromToken?.symbol || 'SUI'}</span>
                                  <ChevronDown size={14} className="text-white/60" />
                                </button>
                              </div>
                              <div className="mt-2 text-xs text-white/40">≈ ${swapFromAmount && !isNaN(parseFloat(swapFromAmount)) ? (parseFloat(swapFromAmount) * (swapFromToken?.price || 0)).toFixed(2) : '0.00'}</div>
                            </div>

                            {/* Swap Arrow */}
                            <div className="flex justify-center -my-3 relative z-20">
                              <button
                                onClick={() => {
                                  const temp = swapFromToken;
                                  setSwapFromToken(swapToToken);
                                  setSwapToToken(temp);
                                  setSwapFromAmount('');
                                  setSwapToAmount('');
                                }}
                                className="w-10 h-10 bg-[#18181B] border-4 border-[#18181B] rounded-xl flex items-center justify-center shadow-lg group"
                              >
                                <div className="w-full h-full bg-[#3F3F46] rounded-lg flex items-center justify-center group-hover:bg-[#00FF88] transition-colors">
                                  <ArrowUp size={18} className="text-white group-hover:text-black transition-colors rotate-180" />
                                </div>
                              </button>
                            </div>

                            {/* To Token */}
                            <div className="bg-[#27272A] rounded-2xl p-4 border border-white/5 pt-6 z-0">
                              <div className="flex justify-between mb-2">
                                <span className="text-xs font-bold text-white/40 uppercase">You Receive</span>
                                <span className="text-xs text-white/40">Balance: {swapToToken?.balance?.toFixed(4) || '0.00'}</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <input
                                  placeholder="0"
                                  value={swapToAmount}
                                  readOnly
                                  className="bg-transparent text-3xl font-bold text-white placeholder-white/20 outline-none w-1/2"
                                />
                                <button className="flex items-center gap-2 bg-black/40 hover:bg-black/60 px-3 py-1.5 rounded-full transition-colors border border-white/10">
                                  <div className="w-6 h-6 bg-[#27AE60] rounded-full flex items-center justify-center text-[10px] font-bold">{swapToToken?.icon || 'U'}</div>
                                  <span className="font-bold text-white">{swapToToken?.symbol || 'USDC'}</span>
                                  <ChevronDown size={14} className="text-white/60" />
                                </button>
                              </div>
                              <div className="mt-2 text-xs text-white/40">≈ ${swapToAmount && !isNaN(parseFloat(swapToAmount)) ? (parseFloat(swapToAmount) * (swapToToken?.price || 0)).toFixed(2) : '0.00'}</div>
                            </div>
                          </div>

                          {/* Rate Info */}
                          <div className="bg-white/5 rounded-xl p-3 mb-4 flex justify-between items-center text-xs">
                            <span className="text-white/40">Rate</span>
                            <span className="text-white/80 font-mono">1 {swapFromToken?.symbol || 'SUI'} ≈ {swapRate.toFixed(2)} {swapToToken?.symbol || 'USDC'}</span>
                          </div>

                          <button
                            onClick={handleSwap}
                            disabled={isSwapping || !swapFromAmount || parseFloat(swapFromAmount) <= 0}
                            className="w-full h-14 bg-[#00FF88] text-black font-bold text-[16px] rounded-xl hover:bg-[#00CC6A] transition-colors active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {isSwapping ? (
                              <>
                                <RefreshCcw size={18} className="animate-spin" />
                                Swapping...
                              </>
                            ) : (
                              <>
                                <RefreshCcw size={18} />
                                Swap Tokens
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </AnimatePresence>

                {/* Tabs */}
                <div className="w-full border-b border-white/10 mb-4">
                  <div className="flex gap-6">
                    {(['Tokens', 'Collectibles', 'Activity'] as const).map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`pb-3 text-sm font-medium transition-colors relative ${activeTab === tab
                          ? 'text-white'
                          : 'text-white/40 hover:text-white/60'
                          }`}
                      >
                        {tab}
                        {activeTab === tab && (
                          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#00FF88]" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Tab Content */}
                <div className="w-full flex-1 overflow-y-auto space-y-2 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                  {activeTab === 'Tokens' && (
                    <>
                      {tokens.length === 0 ? (
                        <div className="text-center text-white/40 py-8">
                          <p>No tokens found</p>
                        </div>
                      ) : (
                        tokens.map((token, idx) => (
                          <div
                            key={idx}
                            className="flex items-center justify-between p-3 rounded-xl hover:bg-white/5 transition-colors cursor-pointer"
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 bg-gradient-to-br from-[#2D9CDB] to-[#1976D2] rounded-full flex items-center justify-center text-white font-bold">
                                {token.icon}
                              </div>
                              <div>
                                <div className="font-medium text-white">{token.symbol}</div>
                                <div className="text-xs text-white/40">
                                  {token.balance.toFixed(4)} {token.symbol}
                                </div>
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="font-medium text-white">
                                ${token.value.toFixed(2)}
                              </div>
                              <div className="text-xs text-white/40">
                                ${token.price.toFixed(2)}
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </>
                  )}

                  {activeTab === 'Collectibles' && (
                    <>
                      {nfts.length === 0 ? (
                        <div className="text-center text-white/40 py-8">
                          <p>No collectibles found</p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-3">
                          {nfts.map((nft, idx) => (
                            <div
                              key={idx}
                              className="bg-white/5 rounded-xl overflow-hidden hover:bg-white/10 transition-colors cursor-pointer"
                            >
                              {nft.image ? (
                                <img
                                  src={nft.image}
                                  alt={nft.name}
                                  className="w-full aspect-square object-cover"
                                />
                              ) : (
                                <div className="w-full aspect-square bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center">
                                  <span className="text-4xl">🖼️</span>
                                </div>
                              )}
                              <div className="p-2">
                                <div className="text-xs font-medium text-white truncate">
                                  {nft.name}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}

                  {activeTab === 'Activity' && (
                    <>
                      {activity.length === 0 ? (
                        <div className="text-center text-white/40 py-8">
                          <p>No recent activity</p>
                        </div>
                      ) : (
                        activity.map((tx, idx) => (
                          <div
                            key={idx}
                            className="flex items-center justify-between p-3 rounded-xl hover:bg-white/5 transition-colors cursor-pointer"
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 bg-white/5 rounded-full flex items-center justify-center">
                                <Send size={16} className="text-white/60" />
                              </div>
                              <div>
                                <div className="font-medium text-white text-sm">
                                  Transaction
                                </div>
                                <div className="text-xs text-white/40 font-mono">
                                  {tx.digest.slice(0, 8)}...
                                </div>
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-xs text-white/60">
                                {tx.effects?.status?.status === 'success' ? (
                                  <span className="text-green-400">Success</span>
                                ) : (
                                  <span className="text-red-400">Failed</span>
                                )}
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </>
                  )}
                </div>

                {/* Settings Overlay */}
                <AnimatePresence>
                  {isSettingsOpen && (
                    <motion.div
                      initial={{ opacity: 0, x: 100 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 100 }}
                      transition={{ duration: 0.2 }}
                      className="absolute inset-0 bg-[#18181B] z-50 p-6 flex flex-col"
                    >
                      {/* Settings Header */}
                      <div className="flex items-center mb-6">
                        <button
                          onClick={() => {
                            setIsSettingsOpen(false);
                            setActiveSubmenu(null);
                          }}
                          className="p-2 -ml-2 rounded-full hover:bg-white/5 transition-colors"
                        >
                          <ChevronRight size={24} className="text-white rotate-180" />
                        </button>
                        <span className="text-lg font-bold text-white ml-2">
                          {activeSubmenu === 'favorites' ? 'Favorite Tokens' : 'Settings'}
                        </span>
                      </div>

                      {/* Settings Content */}
                      <div className="flex flex-col flex-1 min-h-0">
                        <div className="flex-1 overflow-y-auto space-y-6 pr-2 -mr-2">
                          {/* Security Section */}
                          <div className="bg-[#27272A] rounded-2xl overflow-hidden">
                            <button
                              className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors border-b border-white/5"
                            >
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 bg-white/10 rounded-lg flex items-center justify-center">
                                  <Key size={16} className="text-white/80" />
                                </div>
                                <span className="text-white font-medium text-sm">Sui Private Key</span>
                              </div>
                              <ChevronRight size={16} className="text-white/40" />
                            </button>

                            <button
                              className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors border-b border-white/5"
                            >
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 bg-white/10 rounded-lg flex items-center justify-center">
                                  <Fingerprint size={16} className="text-white/80" />
                                </div>
                                <span className="text-white font-medium text-sm">Passkeys</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-white/40 text-xs">0</span>
                                <ChevronRight size={16} className="text-white/40" />
                              </div>
                            </button>
                          </div>

                          {/* Login Section */}
                          <div>
                            <h3 className="text-white/40 text-xs font-medium uppercase mb-2 pl-1">Login</h3>
                            <div className="bg-[#27272A] rounded-2xl overflow-hidden">
                              <button className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors border-b border-white/5">
                                <div className="flex items-center gap-3">
                                  <div className="w-8 h-8 bg-blue-500/20 rounded-lg flex items-center justify-center">
                                    <Wallet size={16} className="text-blue-400" />
                                  </div>
                                  <span className="text-white font-medium text-sm">Linked Wallets</span>
                                </div>
                                <div className="w-6 h-6 rounded bg-white/10 flex items-center justify-center">
                                  <Plus size={14} className="text-white" />
                                </div>
                              </button>

                              <button className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors border-b border-white/5">
                                <div className="flex items-center gap-3">
                                  <div className="w-8 h-8 bg-orange-500/20 rounded-lg flex items-center justify-center">
                                    <Mail size={16} className="text-orange-400" />
                                  </div>
                                  <span className="text-white font-medium text-sm">Email</span>
                                </div>
                                <div className="w-6 h-6 rounded bg-white/10 flex items-center justify-center">
                                  <Plus size={14} className="text-white" />
                                </div>
                              </button>

                              {/* Connected Google Account */}
                              <div className="w-full flex items-center justify-between p-4 bg-white/5">
                                <div className="flex items-center gap-3">
                                  <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center">
                                    <img src="https://www.google.com/favicon.ico" alt="G" className="w-4 h-4" />
                                  </div>
                                  <div className="flex flex-col items-start">
                                    <span className="text-white font-medium text-sm">Google</span>
                                    <span className="text-white/40 text-xs truncate max-w-[120px]">
                                      {currentAccount?.label?.replace('zkLogin - ', '') || 'Connected'}
                                    </span>
                                  </div>
                                </div>
                                <button onClick={() => disconnect()} className="w-6 h-6 rounded bg-white/10 flex items-center justify-center hover:bg-red-500/20 group">
                                  <div className="w-2.5 h-0.5 bg-white/60 group-hover:bg-red-400"></div>
                                </button>
                              </div>

                              <button className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors border-b border-white/5">
                                <div className="flex items-center gap-3">
                                  <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center border border-white/10">
                                    <Twitter size={16} className="text-white" />
                                  </div>
                                  <span className="text-white font-medium text-sm">Twitter</span>
                                </div>
                                <div className="w-6 h-6 rounded bg-white/10 flex items-center justify-center">
                                  <Plus size={14} className="text-white" />
                                </div>
                              </button>

                              <button className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors border-b border-white/5">
                                <div className="flex items-center gap-3">
                                  <div className="w-8 h-8 bg-[#0088cc]/20 rounded-lg flex items-center justify-center">
                                    <Send size={16} className="text-[#0088cc]" />
                                  </div>
                                  <span className="text-white font-medium text-sm">Telegram</span>
                                </div>
                                <div className="w-6 h-6 rounded bg-white/10 flex items-center justify-center">
                                  <Plus size={14} className="text-white" />
                                </div>
                              </button>

                              <button className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors">
                                <div className="flex items-center gap-3">
                                  <div className="w-8 h-8 bg-[#5865F2]/20 rounded-lg flex items-center justify-center">
                                    <Gamepad2 size={16} className="text-[#5865F2]" />
                                  </div>
                                  <span className="text-white font-medium text-sm">Discord</span>
                                </div>
                                <div className="w-6 h-6 rounded bg-white/10 flex items-center justify-center">
                                  <Plus size={14} className="text-white" />
                                </div>
                              </button>
                            </div>
                          </div>
                        </div>

                        <div className="mt-2">
                          <button
                            onClick={() => disconnect()}
                            className="w-full h-12 bg-[#27272A] text-[#FF5252] font-bold rounded-2xl hover:bg-[#27272A]/80 transition-colors"
                          >
                            Log Out
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Bottom Navigation*/}
        {!isDashboard && (
          <div className="md:hidden">
            <BottomNav navItems={navItems} />
          </div>
        )}
      </div >

      {/* Auto Check-in Modal*/}
      <AutoCheckIn />
    </div >
  );
}
