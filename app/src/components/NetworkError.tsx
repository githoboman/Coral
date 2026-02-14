import React from "react";
import { WifiOff, RefreshCw } from "lucide-react";
import { motion } from "framer-motion";

interface NetworkErrorProps {
  onRetry: () => void;
  title?: string;
  description?: string;
}

const NetworkError: React.FC<NetworkErrorProps> = ({
  onRetry,
  title = "Unstable Network Connection",
  description = "We're having trouble connecting to the network. Please check your internet connection and try again.",
}) => {
  return (
    <div className="flex flex-col items-center justify-center w-full h-full min-h-[400px] p-8 text-center bg-[#0a0a0a]/50 backdrop-blur-sm rounded-xl border border-white/5">
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.5 }}
        className="relative mb-6"
      >
        <div className="absolute inset-0 bg-red-500/20 blur-xl rounded-full animate-pulse" />
        <div className="relative bg-[#1a1a1a] p-4 rounded-full border border-white/10 shadow-xl">
          <WifiOff size={48} className="text-red-500" />
        </div>
      </motion.div>

      <motion.h2
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="text-2xl font-bold text-white mb-3"
      >
        {title}
      </motion.h2>

      <motion.p
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="text-gray-400 max-w-md mb-8 leading-relaxed"
      >
        {description}
      </motion.p>

      <motion.button
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.4 }}
        onClick={onRetry}
        className="group relative inline-flex items-center justify-center px-8 py-3 font-medium text-white transition-all duration-200 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 hover:border-white/20 hover:shadow-lg hover:shadow-purple-500/10 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
      >
        <RefreshCw size={18} className="mr-2 group-hover:rotate-180 transition-transform duration-500" />
        Retry Connection
      </motion.button>
    </div>
  );
};

export default NetworkError;
