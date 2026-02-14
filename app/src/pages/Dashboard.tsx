import { useCurrentAccount } from "@mysten/dapp-kit";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useOutletContext } from "react-router-dom";
import { LayoutContextType } from "./Layout";
import NetworkError from "@/components/NetworkError";
import { Sparkles, Terminal, Activity } from "lucide-react";

const Dashboard = () => {
  const currentAccount = useCurrentAccount();
  useOutletContext<LayoutContextType>();

  // Network error state
  const [networkError, setNetworkError] = useState(false);

  const handleRetryNetwork = () => {
    setNetworkError(false);
  };

  return (
    <div className="flex flex-col h-full bg-[#0a0a0a] text-white overflow-hidden relative">
      {/* Main Content Area - Empty Slate */}
      <div className="flex-1 flex items-center justify-center p-8">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5 }}
          className="text-center max-w-lg"
        >
          <div className="relative mb-8 inline-block">
            <div className="absolute inset-0 bg-blue-500/20 blur-3xl rounded-full animate-pulse" />
            <div className="relative bg-[#1a1a1a] p-6 rounded-2xl border border-white/10 shadow-2xl">
              <Sparkles size={48} className="text-blue-400" />
            </div>
          </div>

          <h1 className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-500 mb-4">
            Welcome to Tovira
          </h1>

          <p className="text-gray-400 text-lg leading-relaxed mb-8">
            Your decentralized workspace on Sui. Connect your wallet to access powerful tools and manage your assets.
          </p>

          {!currentAccount ? (
            <div className="p-4 bg-white/5 border border-white/10 rounded-xl text-sm text-gray-400">
              Please connect your Sui wallet to continue.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-colors cursor-pointer group">
                <Activity size={24} className="text-green-400 mb-2 group-hover:scale-110 transition-transform" />
                <h3 className="font-semibold text-white">Activity</h3>
                <p className="text-xs text-gray-500 mt-1">View recent transactions</p>
              </div>
              <div className="p-4 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-colors cursor-pointer group">
                <Terminal size={24} className="text-yellow-400 mb-2 group-hover:scale-110 transition-transform" />
                <h3 className="font-semibold text-white">Commands</h3>
                <p className="text-xs text-gray-500 mt-1">Execute system actions</p>
              </div>
            </div>
          )}
        </motion.div>
      </div>

      {/* Network Error Overlay */}
      <AnimatePresence>
        {networkError && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[70] w-full max-w-2xl px-4"
          >
            <NetworkError onRetry={handleRetryNetwork} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Dashboard;
