"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { MdOutlineMenuOpen } from "react-icons/md";
import React, { useState, useEffect } from "react";
import { FiMoon, FiSun, FiArrowUpRight, FiArrowDownLeft, FiShoppingCart, FiCopy, FiX, FiLogOut, FiRepeat, FiChevronLeft, FiChevronDown } from "react-icons/fi";
import { MdOutlineSwitchAccount } from "react-icons/md";
import { TokenSUI, TokenUSDC } from "@web3icons/react";
import { MdOutlineShoppingCart } from "react-icons/md";


interface TabItem {
  name: string;
  href: string;
}

const NAVIGATION_TABS: TabItem[] = [
  {
    name: "Activities",
    href: "/app/activities",
  },
  {
    name: "History",
    href: "/app/history",
  },
];

const TabIcon = ({ name, isActive }: { name: string; isActive: boolean }) => {
  const fillClass = isActive 
    ? "text-zinc-950 dark:text-zinc-50" 
    : "text-[#5E5E5E] dark:text-zinc-400";
  
  if (name === "New Chat") {
    return (
      <svg width="17" height="17" viewBox="0 0 17 17" fill="none" className={`${fillClass} flex-shrink-0`} xmlns="http://www.w3.org/2000/svg">
        <path d="M7.5 12.5H9.16667V9.16667H12.5V7.5H9.16667V4.16667H7.5V7.5H4.16667V9.16667H7.5V12.5ZM8.33333 16.6667C7.18056 16.6667 6.09722 16.4479 5.08333 16.0104C4.06944 15.5729 3.1875 14.9792 2.4375 14.2292C1.6875 13.4792 1.09375 12.5972 0.65625 11.5833C0.21875 10.5694 0 9.48611 0 8.33333C0 7.18056 0.21875 6.09722 0.65625 5.08333C1.09375 4.06944 1.6875 3.1875 2.4375 2.4375C3.1875 1.6875 4.06944 1.09375 5.08333 0.65625C6.09722 0.21875 7.18056 0 8.33333 0C9.48611 0 10.5694 0.21875 11.5833 0.65625C12.5972 1.09375 13.4792 1.6875 14.2292 2.4375C14.9792 3.1875 15.5729 4.06944 16.0104 5.08333C16.4479 6.09722 16.6667 7.18056 16.6667 8.33333C16.6667 9.48611 16.4479 10.5694 16.0104 11.5833C15.5729 12.5972 14.9792 13.4792 14.2292 14.2292C13.4792 14.9792 12.5972 15.5729 11.5833 16.0104C10.5694 16.4479 9.48611 16.6667 8.33333 16.6667ZM8.33333 15C10.1944 15 11.7708 14.3542 13.0625 13.0625C14.3542 11.7708 15 10.1944 15 8.33333C15 6.47222 14.3542 4.89583 13.0625 3.60417C11.7708 2.3125 10.1944 1.66667 8.33333 1.66667C6.47222 1.66667 4.89583 2.3125 3.60417 3.60417C2.3125 4.89583 1.66667 6.47222 1.66667 8.33333C1.66667 10.1944 2.3125 11.7708 3.60417 13.0625C4.89583 14.3542 6.47222 15 8.33333 15Z" fill="currentColor"/>
      </svg>
    );
  }
  if (name === "Activities") {
    return (
      <svg width="17" height="14" viewBox="0 0 17 14" fill="none" className={`${fillClass} flex-shrink-0`} xmlns="http://www.w3.org/2000/svg">
        <path d="M6 10L8.33333 8.25L10.625 10L9.75 7.16667L12.0833 5.33333H9.25L8.33333 2.5L7.41667 5.33333H4.58333L6.875 7.16667L6 10ZM1.66667 13.3333C1.20833 13.3333 0.815972 13.1701 0.489583 12.8438C0.163194 12.5174 0 12.125 0 11.6667V8.85417C0 8.70139 0.0486111 8.56944 0.145833 8.45833C0.243056 8.34722 0.368056 8.27778 0.520833 8.25C0.854167 8.13889 1.12847 7.9375 1.34375 7.64583C1.55903 7.35417 1.66667 7.02778 1.66667 6.66667C1.66667 6.30556 1.55903 5.97917 1.34375 5.6875C1.12847 5.39583 0.854167 5.19444 0.520833 5.08333C0.368056 5.05556 0.243056 4.98611 0.145833 4.875C0.0486111 4.76389 0 4.63194 0 4.47917V1.66667C0 1.20833 0.163194 0.815972 0.489583 0.489583C0.815972 0.163194 1.20833 0 1.66667 0H15C15.4583 0 15.8507 0.163194 16.1771 0.489583C16.5035 0.815972 16.6667 1.20833 16.6667 1.66667V4.47917C16.6667 4.63194 16.6181 4.76389 16.5208 4.875C16.4236 4.98611 16.2986 5.05556 16.1458 5.08333C15.8125 5.19444 15.5382 5.39583 15.3229 5.6875C15.1076 5.97917 15 6.30556 15 6.66667C15 7.02778 15.1076 7.35417 15.3229 7.64583C15.5382 7.9375 15.8125 8.13889 16.1458 8.25C16.2986 8.27778 16.4236 8.34722 16.5208 8.45833C16.6181 8.56944 16.6667 8.70139 16.6667 8.85417V11.6667C16.6667 12.125 16.5035 12.5174 16.1771 12.8438C15.8507 13.1701 15.4583 13.3333 15 13.3333H1.66667ZM1.66667 11.6667H15V9.54167C14.4861 9.23611 14.0799 8.82986 13.7812 8.32292C13.4826 7.81597 13.3333 7.26389 13.3333 6.66667C13.3333 6.06944 13.4826 5.51736 13.7812 5.01042C14.0799 4.50347 14.4861 4.09722 15 3.79167V1.66667H1.66667V3.79167C2.18056 4.09722 2.58681 4.50347 2.88542 5.01042C3.18403 5.51736 3.33333 6.06944 3.33333 6.66667C3.33333 7.26389 3.18403 7.81597 2.88542 8.32292C2.58681 8.82986 2.18056 9.23611 1.66667 9.54167V11.6667Z" fill="currentColor"/>
      </svg>
    );
  }
  if (name === "History") {
    return (
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none" className={`${fillClass} flex-shrink-0 overflow-visible`} xmlns="http://www.w3.org/2000/svg">
        <path d="M7.5 15C5.58333 15 3.91319 14.3646 2.48958 13.0938C1.06597 11.8229 0.25 10.2361 0.0416667 8.33333H1.75C1.94444 9.77778 2.58681 10.9722 3.67708 11.9167C4.76736 12.8611 6.04167 13.3333 7.5 13.3333C9.125 13.3333 10.5035 12.7674 11.6354 11.6354C12.7674 10.5035 13.3333 9.125 13.3333 7.5C13.3333 5.875 12.7674 4.49653 11.6354 3.36458C10.5035 2.23264 9.125 1.66667 7.5 1.66667C6.54167 1.66667 5.64583 1.88889 4.8125 2.33333C3.97917 2.77778 3.27778 3.38889 2.70833 4.16667H5V5.83333H0V0.833333H1.66667V2.79167C2.375 1.90278 3.23958 1.21528 4.26042 0.729167C5.28125 0.243056 6.36111 0 7.5 0C8.54167 0 9.51736 0.197917 10.4271 0.59375C11.3368 0.989583 12.1285 1.52431 12.8021 2.19792C13.4757 2.87153 14.0104 3.66319 14.4062 4.57292C14.8021 5.48264 15 6.45833 15 7.5C15 8.54167 14.8021 9.51736 14.4062 10.4271C14.0104 11.3368 13.4757 12.1285 12.8021 12.8021C12.1285 13.4757 11.3368 14.0104 10.4271 14.4062C9.51736 14.8021 8.54167 15 7.5 15ZM9.83333 11L6.66667 7.83333V3.33333H8.33333V7.16667L11 9.83333L9.83333 11Z" fill="currentColor"/>
      </svg>
    );
  }
  if (name === "Settings") {
    return (
      <svg width="17" height="17" viewBox="0 0 17 17" fill="none" className={`${fillClass} flex-shrink-0`} xmlns="http://www.w3.org/2000/svg">
        <path d="M6.08333 16.6667L5.75 14C5.56944 13.9306 5.39931 13.8472 5.23958 13.75C5.07986 13.6528 4.92361 13.5486 4.77083 13.4375L2.29167 14.4792L0 10.5208L2.14583 8.89583C2.13194 8.79861 2.125 8.70486 2.125 8.61458C2.125 8.52431 2.125 8.43056 2.125 8.33333C2.125 8.23611 2.125 8.14236 2.125 8.05208C2.125 7.96181 2.13194 7.86806 2.14583 7.77083L0 6.14583L2.29167 2.1875L4.77083 3.22917C4.92361 3.11806 5.08333 3.01389 5.25 2.91667C5.41667 2.81944 5.58333 2.73611 5.75 2.66667L6.08333 0H10.6667L11 2.66667C11.1806 2.73611 11.3507 2.81944 11.5104 2.91667C11.6701 3.01389 11.8264 3.11806 11.9792 3.22917L14.4583 2.1875L16.75 6.14583L14.6042 7.77083C14.6181 7.86806 14.625 7.96181 14.625 8.05208C14.625 8.14236 14.625 8.23611 14.625 8.33333C14.625 8.43056 14.625 8.52431 14.625 8.61458C14.625 8.70486 14.6111 8.79861 14.5833 8.89583L16.7292 10.5208L14.4375 14.4792L11.9792 13.4375C11.8264 13.5486 11.6667 13.6528 11.5 13.75C11.3333 13.8472 11.1667 13.9306 11 14L10.6667 16.6667H6.08333ZM7.54167 15H9.1875L9.47917 12.7917C9.90972 12.6806 10.309 12.5174 10.6771 12.3021C11.0451 12.0868 11.3819 11.8264 11.6875 11.5208L13.75 12.375L14.5625 10.9583L12.7708 9.60417C12.8403 9.40972 12.8889 9.20486 12.9167 8.98958C12.9444 8.77431 12.9583 8.55556 12.9583 8.33333C12.9583 8.11111 12.9444 7.89236 12.9167 7.67708C12.8889 7.46181 12.8403 7.25694 12.7708 7.0625L14.5625 5.70833L13.75 4.29167L11.6875 5.16667C11.3819 4.84722 11.0451 4.57986 10.6771 4.36458C10.309 4.14931 9.90972 3.98611 9.47917 3.875L9.20833 1.66667H7.5625L7.27083 3.875C6.84028 3.98611 6.44097 4.14931 6.07292 4.36458C5.70486 4.57986 5.36806 4.84028 5.0625 5.14583L3 4.29167L2.1875 5.70833L3.97917 7.04167C3.90972 7.25 3.86111 7.45833 3.83333 7.66667C3.80556 7.875 3.79167 8.09722 3.79167 8.33333C3.79167 8.55556 3.80556 8.77083 3.83333 8.97917C3.86111 9.1875 3.90972 9.39583 3.97917 9.60417L2.1875 10.9583L3 12.375L5.0625 11.5C5.36806 11.8194 5.70486 12.0868 6.07292 12.3021C6.44097 12.5174 6.84028 12.6806 7.27083 12.7917L7.54167 15ZM8.41667 11.25C9.22222 11.25 9.90972 10.9653 10.4792 10.3958C11.0486 9.82639 11.3333 9.13889 11.3333 8.33333C11.3333 7.52778 11.0486 6.84028 10.4792 6.27083C9.90972 5.70139 9.22222 5.41667 8.41667 5.41667C7.59722 5.41667 6.90625 5.70139 6.34375 6.27083C5.78125 6.84028 5.5 7.52778 5.5 8.33333C5.5 9.13889 5.78125 9.82639 6.34375 10.3958C6.90625 10.9653 7.59722 11.25 8.41667 11.25Z" fill="currentColor"/>
      </svg>
    );
  }
  return null;
};

/* ─────────────── Wallet Drawer ─────────────── */
function WalletPopup({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const [view, setView] = useState<"wallet" | "send">("wallet");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");

  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const handleClose = () => {
    setVisible(false);
    setTimeout(onClose, 320);
  };

  const assets = [
    {
      symbol: "SUI",
      amount: "1,240.50",
      usd: "$1,488.60",
      rate: "$1.20",
      change: "+2.4%",
      positive: true,
      Icon: TokenSUI,
      iconVariant: "background" as const,
      iconClass: "rounded-full overflow-hidden",
      iconSize: 32,
      iconWrapClass: "mr-1",
    },
    {
      symbol: "USDC",
      amount: "500.00",
      usd: "$500.00",
      rate: "$1.00",
      change: "0.0%",
      positive: true,
      Icon: TokenUSDC,
      iconVariant: "branded" as const,
      iconClass: "",
      iconSize: 40,
      iconWrapClass: "-ml-1.5",
    },
  ];

  const recentActivity = [
    {
      id: 1,
      label: "Swap SUI to USDC",
      sub: "2 mins ago · Success",
      amount: "-50 SUI",
      amountSub: "+$60.00",
      positive: false,
      icon: <img src="/assets/icons/swap.svg" alt="Swap" className="w-[20px] h-[20px] [filter:brightness(0)] dark:[filter:brightness(0)_invert(1)]" />,
      iconBg: "bg-[#F3F2EF] dark:bg-[#1E293B]",
    },
    {
      id: 2,
      label: "Received SUI",
      sub: "1 hour ago · Success",
      amount: "+100 SUI",
      amountSub: "+$120.00",
      positive: true,
      icon: <FiArrowDownLeft className="text-[20px] text-black" />,
      iconBg: "bg-[#F3F2EF] dark:bg-[#132D21]",
    },
  ];

  const usdValue = amount ? (parseFloat(amount) * 1.2).toFixed(2) : "0.00";
  const networkFee = "0.0013";
  const totalEstimated = amount ? (parseFloat(amount) + parseFloat(networkFee)).toFixed(4) : "0.0013";

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setRecipient(text);
    } catch (err) {
      console.error("Failed to read clipboard:", err);
    }
  };

  return (
    <>
      {/* Drawer Panel */}
      <div
        className="fixed right-0 top-0 z-[100] h-screen w-[360px] max-w-full flex flex-col bg-[#F8F7F4]/20 dark:bg-[#1C1C1C]/20 backdrop-blur-[30px] shadow-[-12px_0_48px_rgba(0,0,0,0.15),_-2px_0_8px_rgba(0,0,0,0.05)] transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] overflow-hidden"
        style={{ transform: visible ? "translateX(0)" : "translateX(100%)" }}
      >
        <div
          className="flex h-full w-[720px] transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] bg-transparent"
          style={{ transform: view === "wallet" ? "translateX(0)" : "translateX(-360px)" }}
        >
          {/* VIEW 1: Wallet Details */}
          <div className="w-[360px] h-full flex flex-col flex-shrink-0 relative bg-transparent">
            {/* Glassmorphism Header */}
            <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-5 bg-transparent backdrop-blur-none border-b border-black/[0.06] dark:border-white/[0.06] flex-shrink-0">
              <div>
                <h2 className="text-[20px] font-medium text-black dark:text-zinc-50 leading-tight">Your Wallet</h2>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-[12px] text-[#5E5E5E] dark:text-zinc-500 font-mono">0x7a8b...3c9d</span>
                  <button
                    className="text-[#5E5E5E] hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300 transition-colors cursor-pointer"
                    title="Copy address"
                    onClick={() => navigator.clipboard?.writeText("0x7a8b...3c9d")}
                  >
                    <FiCopy className="text-[12px]" />
                  </button>
                </div>
              </div>
              <button
                onClick={handleClose}
                className="w-8 h-8 flex items-center justify-center text-[#5E5E5E] transition-colors cursor-pointer"
              >
                <FiX className="text-[22px]" />
              </button>
            </div>

            {/* Scrollable Body */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
              {/* Asset Overview */}
              <div>
                <div className="text-[13px] font-bold text-[#5E5E5E] dark:text-zinc-500 mb-3">Asset Overview</div>
                <div className="space-y-3">
                  {assets.map((a) => (
                    <div
                      key={a.symbol}
                      className="bg-white dark:bg-[#272727] border border-[#EFEFED] dark:border-zinc-800 rounded-[18px] px-5 py-4 shadow-sm"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-1">
                          <div className={`flex-shrink-0 flex items-center ${a.iconWrapClass}`}>
                            <a.Icon variant={a.iconVariant} size={a.iconSize} className={a.iconClass} />
                          </div>
                          <span className="text-[16px] font-semibold text-zinc-700 dark:text-zinc-300">{a.symbol}</span>
                        </div>
                        <span className={`text-[15px] font-normal ${a.positive ? "text-[#10B981]" : "text-zinc-400"}`}>
                          {a.change}
                        </span>
                      </div>
                      <div className="text-[24px] font-bold text-zinc-900 dark:text-zinc-50 leading-tight">
                        {a.amount} <span className="text-[19px] font-semibold text-black dark:text-zinc-500">{a.symbol}</span>
                      </div>
                      <div className="text-[13px] text-[#5E5E5E] dark:text-zinc-500 mt-0.5">
                        {a.usd} @ {a.rate}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3">
                {[
                  { label: "Send", Icon: FiArrowUpRight, onClick: () => setView("send") },
                  { label: "Receive", Icon: FiArrowDownLeft, onClick: () => {} },
                  { label: "Buy", Icon: MdOutlineShoppingCart, onClick: () => {} },
                ].map(({ label, Icon, onClick }) => (
                  <button
                    key={label}
                    onClick={onClick}
                    className="flex-1 flex flex-col items-center gap-2 py-2 rounded-[16px] bg-[#F3F2EF] dark:bg-[#272727] hover:bg-zinc-50 dark:hover:bg-zinc-700/40 transition-all cursor-pointer"
                  >
                    <Icon className="text-[24px] text-zinc-600 dark:text-zinc-300" />
                    <span className="text-[13px] font-semibold text-zinc-600 dark:text-zinc-300">{label}</span>
                  </button>
                ))}
              </div>

              {/* Recent Activity */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[13px] font-bold text-[#5E5E5E] dark:text-zinc-500">Recent Activity</span>
                  <button
                    onClick={() => { handleClose(); router.push("/app/activities"); }}
                    className="text-[12px] font-semibold text-black dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors cursor-pointer"
                  >
                    View All
                  </button>
                </div>
                <div className="space-y-3">
                  {recentActivity.map((act) => (
                    <div key={act.id} className="flex items-center gap-3 bg-white dark:bg-[#272727] border border-[#EFEFED] dark:border-zinc-800 rounded-[14px] px-4 py-3.5 shadow-sm">
                      <div className={`w-9 h-9 rounded-full ${act.iconBg} flex items-center justify-center flex-shrink-0 text-zinc-600 dark:text-zinc-300`}>
                        {act.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[14px] font-medium text-black dark:text-zinc-200 truncate">{act.label}</div>
                        <div className="text-[12px] text-[#5E5E5E] font-medium dark:text-zinc-500">{act.sub}</div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className={`text-[15px] font-medium ${act.positive ? "text-[#10B981]" : "text-zinc-700 dark:text-zinc-300"}`}>{act.amount}</div>
                        <div className="text-[12px] text-[#5E5E5E] font-medium dark:text-zinc-500">{act.amountSub}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex-shrink-0 border-t border-[#E7E7E4] dark:border-zinc-800 bg-transparent">
              <div className="px-5 pt-4 pb-2">
                <button className="w-full flex items-center justify-center gap-2 py-3.5 rounded-[14px] border border-[#E7E7E4] dark:border-zinc-800 text-[14px] font-semibold text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100/60 dark:hover:bg-zinc-800/40 transition-colors cursor-pointer active:scale-[0.98]">
                  <MdOutlineSwitchAccount className="text-[20px]" />
                  Switch Account
                </button>
              </div>
              <div className="px-5 pb-5">
                <button className="w-full flex items-center justify-center gap-2 py-3.5 rounded-[14px] bg-[#FFDAD6] dark:bg-[#3F1A1C]/60 text-[15px] font-semibold text-[#BA1A1A] dark:text-[#F28B82] hover:bg-[#FCDCDB] dark:hover:bg-[#3F1A1C] transition-colors cursor-pointer border border-[#FCDCDB] dark:border-[#5C2023] active:scale-[0.98]">
                  <FiLogOut className="text-[15px]" />
                  Disconnect
                </button>
              </div>
            </div>
          </div>

          {/* VIEW 2: Send Assets Form */}
          <div className="w-[360px] h-full flex flex-col flex-shrink-0 relative bg-transparent">
            {/* Header */}
            <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-5 bg-transparent backdrop-blur-none border-b border-black/[0.06] dark:border-white/[0.06] flex-shrink-0">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setView("wallet")}
                  className="w-8 h-8 flex items-center justify-center text-[#5E5E5E] dark:text-[#5E5E5E] hover:bg-neutral-100/60 dark:hover:bg-neutral-850/40 rounded-full transition-colors cursor-pointer"
                >
                  <FiChevronLeft className="text-[22px]" />
                </button>
                <h2 className="text-[20px] font-medium text-black dark:text-neutral-50 leading-tight">Send Assets</h2>
              </div>
              <button
                onClick={handleClose}
                className="w-8 h-8 flex items-center justify-center text-[#5E5E5E] transition-colors cursor-pointer"
              >
                <FiX className="text-[22px]" />
              </button>
            </div>

            {/* Scrollable Form Body */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              {/* Select Asset */}
              <div>
                <label className="block text-[13px] font-medium text-[#5E5E5E] dark:text-[#5E5E5E] mb-2">Select Asset</label>
                <div className="flex items-center justify-between bg-white dark:bg-[#272727] border border-[#EFEFED] dark:border-neutral-800 rounded-[16px] px-4 py-3 shadow-sm cursor-pointer hover:bg-neutral-50/40 dark:hover:bg-neutral-800/20 transition-all">
                  <div className="flex items-center gap-3">
                    <TokenSUI variant="background" size={24} className="rounded-full overflow-hidden flex-shrink-0" />
                    <div>
                      <div className="text-[15px] font-bold text-black dark:text-neutral-50 leading-none">SUI</div>
                      <div className="text-[12px] text-[#5E5E5E] dark:text-[#5E5E5E] mt-1 leading-none">Balance: 1,240.50 SUI</div>
                    </div>
                  </div>
                  <FiChevronDown className="text-[#5E5E5E] dark:text-[#5E5E5E] text-[18px]" />
                </div>
              </div>

              {/* Recipient Address */}
              <div>
                <label className="block text-[13px] font-medium text-[#5E5E5E] dark:text-[#5E5E5E] mb-2">Recipient Address</label>
                <div className="relative flex items-center bg-white dark:bg-[#272727] border border-[#EFEFED] dark:border-neutral-800 rounded-[16px] px-4 py-3.5 shadow-sm">
                  <input
                    type="text"
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                    placeholder="Enter SUI address..."
                    className="w-full pr-20 text-[15px] text-black dark:text-neutral-50 placeholder-[#6B7280] bg-transparent border-none outline-none focus:ring-0"
                  />
                  <div className="absolute right-4 flex items-center gap-1.5">
                    <button
                      onClick={handlePaste}
                      className="text-[12px] font-bold text-neutral-800 dark:text-neutral-200 hover:text-black dark:hover:text-white cursor-pointer transition-colors"
                    >
                      PASTE
                    </button>
                    <img
                      src="/assets/icons/paste.svg"
                      alt="Paste"
                      className="w-[16px] h-[16px] object-contain [filter:brightness(0)] opacity-60 dark:[filter:brightness(0)_invert(1)]"
                    />
                  </div>
                </div>
              </div>

              {/* Amount */}
              <div>
                <label className="block text-[13px] font-medium text-[#5E5E5E] dark:text-[#5E5E5E] mb-2">Amount</label>
                <div className="bg-white dark:bg-[#272727] border border-[#EFEFED] dark:border-neutral-800 rounded-[16px] p-4 shadow-sm space-y-1.5">
                  <div className="flex items-center justify-between">
                    <input
                      type="text"
                      value={amount}
                      onChange={(e) => {
                        if (/^\d*\.?\d*$/.test(e.target.value)) {
                          setAmount(e.target.value);
                        }
                      }}
                      placeholder="0.00"
                      className="w-full text-[28px] font-bold text-black dark:text-neutral-50 placeholder-[#5E5E5E]/40 bg-transparent border-none outline-none focus:ring-0"
                    />
                    <button
                      onClick={() => setAmount("1240.50")}
                      className="px-3 py-1 bg-[#F3F2EF] dark:bg-[#3C3C3C] text-[12px] font-bold text-black dark:text-neutral-200 rounded-lg hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors cursor-pointer"
                    >
                      MAX
                    </button>
                  </div>
                  <div className="text-[14px] text-[#5E5E5E] dark:text-[#5E5E5E]">
                    ≈ ${usdValue} USD
                  </div>
                </div>
              </div>

              {/* Estimated Fees Box */}
              <div className="bg-[#F3F2EF80] dark:bg-[#272727]/60 border border-[#E7E7E480] dark:border-neutral-800/50 rounded-[16px] p-4 space-y-3">
                <div className="flex justify-between items-center text-[13px]">
                  <span className="text-[#5E5E5E] dark:text-[#5E5E5E]">Network Fee</span>
                  <span className="font-mono font-bold text-black dark:text-neutral-200">{networkFee} SUI</span>
                </div>
                <div className="flex justify-between items-center text-[14px]">
                  <span className="font-semibold text-black dark:text-neutral-150">Total Estimated</span>
                  <span className="font-mono font-sans text-black font-bold dark:text-neutral-50">{totalEstimated} SUI</span>
                </div>
              </div>
            </div>

            {/* Footer Send Action */}
            <div className="flex-shrink-0 p-5 border-t border-[#E7E7E4] dark:border-neutral-800 bg-transparent">
              <button
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-[14px] bg-black text-white dark:bg-neutral-50 dark:text-black text-[15px] font-semibold hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors cursor-pointer active:scale-[0.98]"
              >
                <FiArrowUpRight className="text-[24px]" />
                Send Assets
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}


export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const pathname = usePathname();
  const [isDark, setIsDark] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isWalletOpen, setIsWalletOpen] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("theme");
    if (
      saved === "dark" ||
      (!saved && window.matchMedia("(prefers-color-scheme: dark)").matches)
    ) {
      setIsDark(true);
      document.documentElement.classList.add("dark");
    } else {
      setIsDark(false);
      document.documentElement.classList.remove("dark");
    }
  }, []);

  const toggleDarkMode = () => {
    if (isDark) {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
      setIsDark(false);
    } else {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
      setIsDark(true);
    }
  };

  const isTabActive = (href: string) => {
    return pathname === href || (href !== "/app/chat" && pathname.startsWith(href + "/"));
  };

  // Shared function to determine class names based on active state
  const getTabClassName = (href: string) => {
    const base = isCollapsed
      ? "flex h-[48px] w-[48px] items-center justify-center rounded-xl transition-all active:scale-[0.98] mx-auto"
      : "flex h-[48px] items-center gap-3 rounded-xl px-5 text-[0.92rem] font-semibold transition-all active:scale-[0.98]";
    const active = "bg-[#F3F2EF] border border-[#E7E7E4] shadow-[0_1px_2px_rgba(0,0,0,0.05)] text-zinc-900 dark:bg-[#2F2F2F] dark:border-black dark:text-zinc-200";
    const inactive = "border border-transparent text-zinc-500 hover:text-zinc-950 hover:bg-zinc-100/50 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-900/30";
    return `${base} ${isTabActive(href) ? active : inactive}`;
  };

  return (
    <>
    <div className="flex h-screen w-screen overflow-hidden bg-white dark:bg-zinc-950 font-sans transition-colors duration-200">
      {/* Sidebar navigation */}
      <aside className={`flex h-full flex-col border-r border-[#E7E7E4] bg-white/40 dark:border-zinc-800 dark:bg-[#242424] transition-all duration-300 ${isCollapsed ? "w-[80px] px-4 py-6" : "w-[260px] p-6"}`}>
        
        {/* Header */}
        <div className={`flex items-center ${isCollapsed ? "justify-center" : "justify-between"}`}>
          {!isCollapsed && (
            <span className="text-[1.4rem] font-bold tracking-tight text-zinc-900 dark:text-zinc-50 leading-none">
              Corral
            </span>
          )}
          <button 
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300 cursor-pointer"
          >
            <MdOutlineMenuOpen className={`text-2xl transform transition-transform duration-300 ${isCollapsed ? "rotate-180" : ""}`} />
          </button>
        </div>
 
        {/* Main Nav Items (rendered from constant) */}
        <nav className="mt-8 flex flex-col gap-3">
          <Link
            href="/app/chat"
            className={getTabClassName("/app/chat")}
            title={isCollapsed ? "New Chat" : undefined}
          >
            <TabIcon name="New Chat" isActive={isTabActive("/app/chat")} />
            {!isCollapsed && "New Chat"}
          </Link>
 
          {NAVIGATION_TABS.map((tab) => {
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={getTabClassName(tab.href)}
                title={isCollapsed ? tab.name : undefined}
              >
                <TabIcon name={tab.name} isActive={isTabActive(tab.href)} />
                {!isCollapsed && tab.name}
              </Link>
            );
          })}
        </nav>
 
        {/* Bottom Settings Link */}
        <div className="mt-auto">
          <Link
            href="/app/settings"
            className={getTabClassName("/app/settings")}
            title={isCollapsed ? "Settings" : undefined}
          >
            <TabIcon name="Settings" isActive={isTabActive("/app/settings")} />
            {!isCollapsed && "Settings"}
          </Link>
        </div>

      </aside>

      {/* Main Content Area */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {/* App Header */}
        <header className="flex h-[72px] items-center justify-between border-b border-white/40 bg-white/25 px-8 backdrop-blur-[64px] dark:border-white/15 dark:bg-[#232323]">
          
          {/* Left Pill (Agent Status) */}
          <div className="flex items-center gap-3.5 bg-[#F8F9FA]/80 border border-[#E7E7E4] rounded-full px-4 py-2 text-[0.8rem] font-semibold text-zinc-500 dark:bg-[#2F2F2F] dark:border-black dark:text-[#5E5E5E]">
            <span className="flex items-center gap-1.5 font-medium text-black dark:text-[#5E5E5E]">
              <span className="w-2 h-2 rounded-full bg-[#10B981] animate-pulse" />
              Agent: <span className="text-zinc-900 dark:text-[#5E5E5E] font-bold">Active</span>
            </span>
            
            <span className="w-[2px] h-3.5 bg-[#D2D2CD] dark:bg-white" />
            
            <span className="flex items-center gap-2 font-medium text-black dark:text-[#5E5E5E]">
              Budget:
              <span className="relative flex items-center w-16 h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
                <span className="absolute left-0 top-0 h-full w-[45%] bg-zinc-900 dark:bg-zinc-100 rounded-full" />
              </span>
              <span className="text-zinc-900 dark:text-white font-mono font-bold">45%</span>
            </span>
            
            <span className="w-[2px] h-3.5 bg-[#D2D2CD] dark:bg-white" />
            
            <span className="text-black dark:text-[#5E5E5E] font-medium">
              Expires in: <span className="text-zinc-900 dark:text-white font-mono font-bold">02:14:00</span>
            </span>
          </div>

          {/* Right Controls */}
          <div className="flex items-center gap-1.5">
            {/* Dark Mode Toggle */}
            <button 
              onClick={toggleDarkMode}
              className="flex h-10 w-10 items-center justify-center bg-transparent text-[#5E5E5E] hover:text-zinc-950 active:scale-[0.98] dark:bg-transparent dark:text-zinc-400 dark:hover:text-zinc-200 cursor-pointer"
              title="Toggle theme"
            >
              {isDark ? (
                <img 
                  src="/assets/icons/sun.svg" 
                  alt="Toggle theme" 
                  width={18} 
                  height={18} 
                  className="object-contain flex-shrink-0"
                />
              ) : (
                <img 
                  src="/assets/icons/moon.svg" 
                  alt="Toggle theme" 
                  width={17} 
                  height={17} 
                  className="object-contain flex-shrink-0"
                />
              )}
            </button>
 
            {/* Notifications */}
            <button 
              className="flex h-10 w-10 items-center justify-center bg-transparent text-[#5E5E5E] active:scale-[0.98] dark:bg-transparent dark:text-zinc-400 dark:hover:text-zinc-200 cursor-pointer"
              title="Notifications"
            >
              <img 
                src="/assets/icons/bell.svg" 
                alt="Notifications" 
                width={16} 
                height={16} 
                className="object-contain flex-shrink-0"
              />
            </button>
 
            {/* Wallet Icon */}
            <div className="relative">
              <button 
                onClick={() => setIsWalletOpen((o) => !o)}
                className={`flex h-10 w-10 items-center justify-center bg-transparent active:scale-[0.98] dark:bg-transparent cursor-pointer transition-colors ${isWalletOpen ? "text-zinc-950 dark:text-zinc-100" : "text-[#5E5E5E] hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-200"}`}
                title="Wallet"
              > 
                <img 
                  src="/assets/icons/wallet.svg" 
                  alt="Wallet" 
                  width={17} 
                  height={17} 
                  className="object-contain flex-shrink-0"
                />
              </button>
            </div>

 
            {/* Connect Wallet Button */}
            <button 
              className="flex h-[42px] items-center justify-center rounded-full bg-zinc-950 text-[0.92rem] font-medium text-white px-5 shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition-all hover:bg-zinc-800 active:scale-[0.98] dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200 cursor-pointer ml-[2px]"
            >
              Connect Wallet
            </button>
          </div>
        </header>

        {/* Page Content */}
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </main>
    </div>
    {isWalletOpen && <WalletPopup onClose={() => setIsWalletOpen(false)} />}
    </>
  );
}
