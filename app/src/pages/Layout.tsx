import { Outlet, useLocation } from 'react-router-dom';
import {
  Copy, Check, LogOut, MessageSquare, Users, User, Bell,
  Settings as SettingsIcon, Wallet,
  Plus, X, Home, Activity, Minus, ChevronRight, Heart, Key, Fingerprint, Mail, Twitter as TwitterIcon, Hexagon, Send,
  RefreshCcw, ArrowUp, ChevronDown,
} from 'lucide-react';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { useDisconnectWallet } from '@mysten/dapp-kit';
import { AuthProvider } from '@/components/auth/AuthProvider';
import { Sidebar } from '@/components/app/Sidebar';
import { BottomNav } from '@/components/app/BottomNav';
import { MobileTopBar } from '@/components/app/MobileTopBar';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

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
  const { address, createNewPasskey, getKeypair } = useAuth();
  const { mutate: disconnect } = useDisconnectWallet();

  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [isWalletCollapsed, setIsWalletCollapsed] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeSubmenu, setActiveSubmenu] = useState<'favorites' | 'passkeys' | null>(null);

  const [activeWalletModal, setActiveWalletModal] = useState<'deposit' | 'send' | 'swap' | null>(null);
  const [activeTab, setActiveTab] = useState<'Tokens' | 'Collectibles' | 'Activity'>('Tokens');

  const [walletBalanceUSD, setWalletBalanceUSD] = useState<string>('0.00');
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  const [swapRate, setSwapRate] = useState<number>(1.85); // Mock rate for now

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
      const keypair = getKeypair();
      if (!keypair) {
        throw new Error('Wallet not connected');
      }

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

      // Build and sign transaction
      const txBytes = await tx.build({ client: suiClient });
      const { signature } = await keypair.signTransaction(txBytes);

      // Execute transaction
      const result = await suiClient.executeTransactionBlock({
        transactionBlock: txBytes,
        signature,
        options: {
          showEffects: true,
          showObjectChanges: true,
        },
      });

      if (result.effects?.status?.status === 'success') {
        toast.success(`Sent ${sendAmount} ${selectedSendToken.symbol} successfully!`, { theme: 'dark' });

        // Reset form
        setSendRecipient('');
        setSendAmount('');

        // Refresh balance
        fetchBalance();

        // Close modal after a short delay
        setTimeout(() => {
          setActiveWalletModal(null);
        }, 1500);
      } else {
        throw new Error('Transaction failed');
      }
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

      <AuthProvider>
        <div className="flex w-full h-dvh overflow-x-hidden overflow-y-auto">
          {/* Sidebar - Hidden on mobile, visible on desktop */}
          <div className="sticky top-0 p-4 hidden md:flex">
            <Sidebar navItems={navItems} onSignOut={() => disconnect()} />
          </div>

          {/* Main Content - Add bottom padding on mobile for bottom nav */}
          <div className="h-fit flex-1 pb-20 md:pb-0">
            <MobileTopBar balance={walletBalanceUSD} onWalletClick={() => setIsWalletCollapsed(false)} />
            <Outlet />
          </div>

          {/* Wallet Section */}
          <div className={`sticky top-0 p-0 md:p-4 ${!isWalletCollapsed ? 'fixed inset-0 z-[60] flex justify-end bg-[#18181B] md:bg-transparent md:backdrop-blur-none md:block' : 'hidden md:block'}`}>
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
                  initial={{ opacity: 0, right: -100 }}
                  animate={{ opacity: 1, right: 0 }}
                  exit={{ opacity: 0, right: -100 }}
                  transition={{ duration: 0.3 }}
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
                                'Review Swap'
                              )}
                            </button>
                          </div>
                        )}

                      </div>
                    )}
                  </AnimatePresence>

                  <div className="w-full">
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
                    <div className="bg-white/5 rounded-[30px] rounded-tl-none text-white/80 overflow-hidden min-h-[200px] max-h-[300px] overflow-y-auto custom-scrollbar">
                      {activeTab === 'Tokens' && (
                        <div className="flex flex-col">
                          {tokens.length === 0 ? <div className="p-6 text-center text-white/40 text-sm">No tokens found</div> : tokens.map((t, i) => (
                            <div key={i} className="flex justify-between items-center p-4 hover:bg-white/5 border-b border-white/5 last:border-0 transition-colors cursor-default">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold">{t.icon || t.symbol[0]}</div>
                                <div>
                                  <div className="font-bold text-sm">{t.symbol}</div>
                                  <div className="text-[10px] text-white/40">{t.balance < 0.000001 ? '0' : t.balance.toLocaleString()}</div>
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="font-mono text-sm">${t.value.toFixed(2)}</div>
                                <div className="text-[10px] text-white/40">${t.price?.toFixed(2)}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {activeTab === 'Collectibles' && (
                        <div className="p-4 grid grid-cols-2 gap-2">
                          {nfts.length === 0 ? <div className="col-span-2 py-8 text-center text-white/40 text-sm">No collectibles found</div> : nfts.map((nft, i) => (
                            <div key={i} className="aspect-square bg-white/5 rounded-xl border border-white/5 overflow-hidden group/nft relative">
                              {nft.image ? <img src={nft.image} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-white/20">NFT</div>}
                              <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover/nft:opacity-100 transition-opacity flex flex-col justify-end p-2">
                                <span className="text-[10px] font-bold truncate">{nft.name}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {activeTab === 'Activity' && (
                        <div className="flex flex-col">
                          {activity.length === 0 ? <div className="p-6 text-center text-white/40 text-sm">No recent activity</div> : activity.map((tx, i) => {
                            const isSuccess = tx.effects?.status?.status === 'success';
                            const timestamp = tx.timestampMs ? new Date(Number(tx.timestampMs)) : null;
                            return (
                              <div key={i} className="flex items-center gap-3 p-4 hover:bg-white/5 border-b border-white/5 last:border-0 transition-colors">
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${isSuccess ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                                  <Activity size={12} />
                                </div>
                                <div className="flex-1 overflow-hidden">
                                  <div className="flex justify-between items-center mb-0.5">
                                    <span className="text-xs font-bold truncate">{tx.digest.slice(0, 8)}...</span>
                                    <span className="text-[10px] text-white/40 font-mono">{timestamp ? timestamp.toLocaleDateString() : ''}</span>
                                  </div>
                                  <div className="text-[10px] text-white/60 truncate">Transaction Block</div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>

                  {isSettingsOpen && (
                    <div className="absolute inset-0 bg-[#1A1A1A] z-20 flex flex-col animate-in slide-in-from-right duration-300">

                      {activeSubmenu === 'favorites' && (
                        <>
                          <div className="flex items-center p-4 border-b border-white/5">
                            <button onClick={() => setActiveSubmenu(null)} className="p-2 -ml-2 rounded-full hover:bg-white/5 transition-colors">
                              <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center">
                                <ChevronRight className="w-5 h-5 text-white/60 rotate-180" />
                              </div>
                            </button>
                            <h2 className="flex-1 text-center font-bold text-lg mr-8">Favorites</h2>
                          </div>
                          <div className="flex-1 p-4">
                            <p className="text-white/40 text-center text-sm">No favorite addresses yet.</p>
                            <button className="mt-4 w-full py-2 bg-white/5 text-sm rounded-xl hover:bg-white/10 transition-colors">
                              Add New Address
                            </button>
                          </div>
                        </>
                      )}

                      {activeSubmenu === 'passkeys' && (
                        <>
                          <div className="flex items-center p-4 border-b border-white/5">
                            <button onClick={() => setActiveSubmenu(null)} className="p-2 -ml-2 rounded-full hover:bg-white/5 transition-colors">
                              <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center">
                                <ChevronRight className="w-5 h-5 text-white/60 rotate-180" />
                              </div>
                            </button>
                            <h2 className="flex-1 text-center font-bold text-lg mr-8">Passkeys</h2>
                          </div>
                          <div className="flex-1 p-4">
                            <div className="bg-[#2D2D2D] rounded-2xl p-4 mb-4">
                              <div className="flex items-center gap-3">
                                <Fingerprint className="w-8 h-8 text-green-400 p-1.5 bg-green-500/10 rounded-lg" />
                                <div>
                                  <p className="font-bold text-sm">Main Passkey</p>
                                  <p className="text-xs text-white/40">Used for login</p>
                                </div>
                              </div>
                            </div>
                            <button
                              onClick={() => createNewPasskey?.()}
                              className="w-full py-3 bg-[#00FF88] text-black font-bold rounded-xl hover:bg-[#00CC6A] transition-colors"
                            >
                              Create New Passkey
                            </button>
                          </div>
                        </>
                      )}

                      {!activeSubmenu && (
                        <>
                          {/* Header */}
                          <div className="flex items-center p-4 border-b border-white/5">
                            <button onClick={toggleSettings} className="p-2 -ml-2 rounded-full hover:bg-white/5 transition-colors">
                              <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center">
                                <ChevronRight className="w-5 h-5 text-white/60 rotate-180" />
                              </div>
                            </button>
                            <h2 className="flex-1 text-center font-bold text-lg mr-8">Settings</h2>
                          </div>

                          <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar">

                            {/* Favorite Addresses */}
                            <div
                              onClick={() => setActiveSubmenu('favorites')}
                              className="bg-[#2D2D2D] rounded-2xl p-4 flex items-center gap-3 cursor-pointer hover:bg-[#3D3D3D] transition-colors"
                            >
                              <div className="w-10 h-10 rounded-full bg-pink-500/20 flex items-center justify-center">
                                <Heart className="w-5 h-5 text-pink-500 fill-pink-500/20" />
                              </div>
                              <span className="font-medium">Favorite Addresses</span>
                            </div>

                            {/* Security Section */}
                            <div>
                              <h3 className="text-white/40 text-sm font-medium mb-2 pl-1">Security</h3>
                              <div className="bg-[#2D2D2D] rounded-2xl overflow-hidden divide-y divide-white/5">
                                <div className="p-4 flex items-center justify-between hover:bg-[#3D3D3D] cursor-pointer transition-colors" onClick={() => toast.info('Sui Private Key viewing is not supported with Passkey accounts.', { theme: "dark" })}>
                                  <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center">
                                      <Key className="w-4 h-4 text-white/60" />
                                    </div>
                                    <span className="font-medium text-sm">Sui Private Key</span>
                                  </div>
                                  <ChevronRight className="w-4 h-4 text-white/40" />
                                </div>
                                <div className="p-4 flex items-center justify-between hover:bg-[#3D3D3D] cursor-pointer transition-colors" onClick={() => toast.info('Recovery Phrase viewing is not supported with Passkey accounts.', { theme: "dark" })}>
                                  <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center">
                                      <Key className="w-4 h-4 text-white/60" />
                                    </div>
                                    <span className="font-medium text-sm">Recovery Phrase</span>
                                  </div>
                                  <ChevronRight className="w-4 h-4 text-white/40" />
                                </div>
                                <div
                                  onClick={() => setActiveSubmenu('passkeys')}
                                  className="p-4 flex items-center justify-between hover:bg-[#3D3D3D] cursor-pointer transition-colors"
                                >
                                  <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center">
                                      <Fingerprint className="w-4 h-4 text-white/60" />
                                    </div>
                                    <span className="font-medium text-sm">Passkeys</span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-white/40 text-sm">1</span>
                                    <ChevronRight className="w-4 h-4 text-white/40" />
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* Login Section */}
                            <div>
                              <h3 className="text-white/40 text-sm font-medium mb-2 pl-1">Login</h3>
                              <div className="bg-[#2D2D2D] rounded-2xl overflow-hidden divide-y divide-white/5">
                                {/* Mock Social Logins */}
                                {[
                                  { name: 'Linked Wallets', icon: Wallet, color: 'text-blue-400', bg: 'bg-blue-500/20' },
                                  { name: 'Email', icon: Mail, color: 'text-orange-400', bg: 'bg-orange-500/20' },
                                  { name: 'Google', icon: null, img: 'https://www.google.com/favicon.ico', color: '', bg: 'bg-white/90' },
                                  { name: 'Twitter', icon: TwitterIcon, color: 'text-white', bg: 'bg-black' },
                                  { name: 'Telegram', icon: Send, color: 'text-white', bg: 'bg-blue-400', rotate: true },
                                  { name: 'Discord', icon: MessageSquare, color: 'text-indigo-400', bg: 'bg-indigo-500/20' },
                                ].map((item, i) => (
                                  <div key={i} className="p-4 flex items-center justify-between hover:bg-[#3D3D3D] cursor-pointer transition-colors" onClick={() => toast.info(`${item.name} integration coming soon!`, { theme: "dark" })}>
                                    <div className="flex items-center gap-3">
                                      <div className={`w-8 h-8 rounded-lg ${item.bg} flex items-center justify-center border border-white/5`}>
                                        {item.icon ? (
                                          <item.icon className={`w-4 h-4 ${item.color} ${item.rotate ? 'rotate-[-45deg] translate-x-0.5' : ''}`} />
                                        ) : (
                                          <img src={item.img} alt={item.name} className="w-4 h-4" />
                                        )}
                                      </div>
                                      <div className="flex flex-col">
                                        <span className="font-medium text-sm">{item.name}</span>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                      <button className="w-6 h-6 rounded bg-white/10 flex items-center justify-center hover:bg-white/20">
                                        <Plus className="w-4 h-4 text-white" />
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>

                          <div className="p-4 border-t border-white/5 mt-auto">
                            <button
                              onClick={() => disconnect()}
                              className="w-full py-3 rounded-xl bg-white/5 hover:bg-red-500/10 text-white/60 hover:text-red-400 font-bold transition-colors"
                            >
                              Log Out
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Bottom Navigation - Only visible on mobile */}
        <BottomNav navItems={navItems} />
      </AuthProvider>
    </div>
  );
}
