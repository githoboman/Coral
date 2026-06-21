"use client";

import React from "react";
import { useRouter } from "next/navigation";
import {
  FiCopy,
} from "react-icons/fi";
import { HiArrowUp, HiArrowDown } from "react-icons/hi";
import { MdOutlineVerified } from "react-icons/md";
import { IoIosArrowBack } from "react-icons/io";
import { MdOutlineCheckCircle } from "react-icons/md";

// Static detail data keyed by activity id
const ACTIVITY_DETAILS: Record<string, {
  title: string;
  pair: string;
  status: "success" | "pending" | "failed" | "info";
  hash: string;
  overview: { date: string; protocol: string; type: string; network: string };
  execution: { inputAmount: string; inputAsset: string; inputSub: string; outputAmount: string; outputAsset: string; fees: string; slippage: string };
  compliance: Array<{ label: string; result: string }>;
}> = {
  "1": {
    title: "Swap Execution",
    pair: "SUI / USDC",
    status: "success",
    hash: "0x7a8b...3c9d",
    overview: {
      date: "14:02 UTC",
      protocol: "Deepbook V3",
      type: "Market Swap",
      network: "Sui Mainnet",
    },
    execution: {
      inputAmount: "150.0 SUI",
      inputAsset: "SUI",
      inputSub: "($4.50/SUI)",
      outputAmount: "675.0 USDC",
      outputAsset: "USDC",
      fees: "0.12 SUI (Net) + 0.05% (Dex)",
      slippage: "0.2% (Adjusted)",
    },
    compliance: [
      { label: "Budget Check", result: "Pass" },
      { label: "Asset Whitelist", result: "Pass" },
      { label: "Protocol Safety", result: "Pass" },
    ],
  },
};

const STATUS_CONFIG = {
  success: { label: "SUCCESS", bg: "bg-[#E1F1EA]", text: "text-[#10B981]", dot: "bg-[#10B981]" },
  pending: { label: "PENDING", bg: "bg-[#EEF2F6]", text: "text-[#4F46E5]", dot: "bg-[#4F46E5]" },
  failed:  { label: "FAILED",  bg: "bg-[#FCE8E6]", text: "text-[#EA4335]", dot: "bg-[#EA4335]" },
  info:    { label: "INFO",    bg: "bg-zinc-100",   text: "text-zinc-500",  dot: "bg-zinc-400" },
};

export default function ActivityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { id } = React.use(params);
  const detail = ACTIVITY_DETAILS[id];

  if (!detail) {
    return (
      <div className="flex h-full items-center justify-center text-zinc-400 dark:text-zinc-500 font-sans">
        Activity not found.
      </div>
    );
  }

  const status = STATUS_CONFIG[detail.status];

  return (
    <div className="h-full w-full overflow-y-auto bg-[#F7F7F5] dark:bg-[#262626] font-sans transition-colors duration-200">
      <div className="w-full px-6 py-8 space-y-6">

        {/* Back + Title Row */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => router.back()}
            className="flex items-center justify-center w-9 h-9 text-[#5E5E5E] dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-all cursor-pointer active:scale-95 flex-shrink-0"
            title="Go back"
          >
            <IoIosArrowBack className="text-[16px]" />
          </button>

          <div className="flex items-center gap-3 flex-1 min-w-0">
            <h1 className="text-[28px] font-normal text-zinc-900 dark:text-zinc-50 leading-tight whitespace-nowrap font-geist">
              {detail.title}
            </h1>
            <span className="w-[1px] h-6 bg-[#D2D2CD] dark:bg-zinc-700 flex-shrink-0" />
            <span className="text-[18px] font-normal text-[#5E5E5E] dark:text-zinc-400 whitespace-nowrap font-geist">
              {detail.pair}
            </span>
          </div>
        </div>

        {/* Cards — extra x padding */}
        <div className="px-16 space-y-4">

        {/* Status + Hash Row */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Status Badge */}
          <span className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-bold tracking-wide ${status.bg} ${status.text}`}>
            <MdOutlineCheckCircle className="text-[13px]" />
            {status.label}
          </span>

          {/* Hash */}
          <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#F3F2EF] dark:bg-[#2F2F2F] border border-[#E7E7E4] dark:border-black text-[12px] font-mono text-[#5E5E5E] dark:text-zinc-400">
            Hash:
            <span className="font-bold text-zinc-800 dark:text-zinc-200">{detail.hash}</span>
            <button className="hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors cursor-pointer" title="Copy hash">
              <FiCopy className="text-[13px]" />
            </button>
          </div>
        </div>

        

          {/* Two-column cards */}
          <div className="grid grid-cols-2 gap-4">
            {/* OVERVIEW */}
            <div className="bg-white dark:bg-[#2F2F2F] border border-[#FFFFFF99] dark:border-black rounded-[20px] p-6 shadow-sm">
              <div className="text-[15px] font-sans font-bold text-[#5E5E5E] dark:text-zinc-500 uppercase tracking-widest mb-5">
                Overview
              </div>
              <div className="space-y-4">
                {[
                  { label: "Date/Time", value: detail.overview.date, mono: true },
                  { label: "Protocol",  value: detail.overview.protocol },
                  { label: "Type",      value: detail.overview.type },
                  { label: "Network",   value: detail.overview.network, dot: true },
                ].map(({ label, value, mono, dot }) => (
                  <div key={label} className="flex items-center justify-between">
                    <span className="text-[15px] text-[#5E5E5E] dark:text-zinc-400 font-geist">{label}</span>
                    <span className={`text-[15px] text-black dark:text-zinc-100 font-geist flex items-center gap-1.5 ${mono ? "font-mono font-bold" : "font-normal"}`}>
                      {dot && <span className="w-2 h-2 rounded-full bg-[#6366F1] flex-shrink-0" />}
                      {value}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* EXECUTION DETAILS */}
            <div className="bg-white dark:bg-[#2F2F2F] border border-[#FFFFFF99] dark:border-black rounded-[20px] p-6 shadow-sm">
              <div className="text-[15px] font-sans font-bold text-[#5E5E5E] dark:text-zinc-500 uppercase tracking-widest mb-5">
                Execution Details
              </div>

              {/* Input row */}
              <div className="flex items-center justify-between bg-[#F3F2EF] dark:bg-zinc-900/40 border border-[#E7E7E4] dark:border-zinc-800 rounded-xl px-4 py-3 mb-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center">
                    <HiArrowUp className="text-[#5E5E5E] text-[22px]" />
                  </div>
                  <span className="text-[15px] text-[#5E5E5E] dark:text-zinc-400 font-geist">Input</span>
                </div>
                <div className="text-right">
                  <div className="text-[14px] font-bold text-zinc-900 dark:text-zinc-100 font-mono">{detail.execution.inputAmount}</div>
                  <div className="text-[11px] text-[#8B8B8A] dark:text-zinc-500 font-mono font-bold">{detail.execution.inputSub}</div>
                </div>
              </div>

              {/* Output row */}
              <div className="flex items-center justify-between bg-[#F3F2EF] dark:bg-zinc-900/40 border border-[#E7E7E4] dark:border-zinc-800 rounded-xl px-4 py-3 mb-4">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center">
                    <HiArrowDown className="text-[#10B981] text-[22px]" />
                  </div>
                  <span className="text-[15px] text-[#5E5E5E] dark:text-zinc-400 font-geist">Output</span>
                </div>
                <div className="text-[14px] font-bold text-zinc-900 dark:text-zinc-100 font-mono">
                  {detail.execution.outputAmount}
                </div>
              </div>

              {/* Fees + Slippage */}
              <div className="space-y-2 border-t border-[#F1F1EF] dark:border-zinc-800 pt-3">
                <div className="flex justify-between">
                  <span className="text-[13px] text-[#5E5E5E] dark:text-zinc-500 font-geist">Fees</span>
                  <span className="text-[12px] font-semibold text-zinc-700 dark:text-zinc-300 font-mono">{detail.execution.fees}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[12px] text-[#5E5E5E] dark:text-zinc-500 font-geist">Slippage</span>
                  <span className="text-[12px] font-semibold text-zinc-700 dark:text-zinc-300 font-mono">{detail.execution.slippage}</span>
                </div>
              </div>
            </div>
          </div>

          {/* POLICY COMPLIANCE */}
          <div className="bg-white dark:bg-[#2F2F2F] border border-[#FFFFFF99] dark:border-black rounded-[20px] p-6 shadow-sm">
            <div className="text-[11px] font-mono font-bold text-[#5E5E5E] dark:text-zinc-500 uppercase tracking-widest mb-5">
              Policy Compliance
            </div>

            <div className="grid grid-cols-3 gap-3">
              {detail.compliance.map((item) => (
                <div
                  key={item.label}
                  className="flex items-center gap-3 bg-[#F3F2EF] dark:bg-zinc-900/40 border border-[#E7E7E4] dark:border-zinc-800 rounded-xl px-4 py-3.5"
                >
                  <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0">
                    <MdOutlineVerified className="text-[#10B981] text-[24px]" />
                  </div>
                  <div>
                    <div className="text-[11px] font-bold text-[#5E5E5E] dark:text-zinc-400 uppercase tracking-wide font-geist">
                      {item.label}
                    </div>
                    <div className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-100 font-geist">
                      {item.result}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}
