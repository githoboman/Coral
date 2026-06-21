"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { 
  FiDownload, 
  FiChevronDown, 
  FiEdit2, 
  FiShield,
  FiHexagon,
  FiDollarSign
} from "react-icons/fi";
import { MdFilterList } from "react-icons/md";
import { RiShareBoxLine } from "react-icons/ri";
import { MdLockOutline } from "react-icons/md";
import { IoMdStopwatch } from "react-icons/io";
import { TokenSUI, TokenUSDC } from "@web3icons/react";

interface ActivityItem {
  id: string;
  action: string;
  subaction: string;
  details: string;
  subdetails: string;
  protocol: string;
  time: string;
  status: "success" | "pending" | "failed" | "info";
  isInternal: boolean;
}

export default function ActivitiesPage() {
  const router = useRouter();
  const [activities, setActivities] = useState<ActivityItem[]>([
    {
      id: "1",
      action: "Swap Execution",
      subaction: "Rebalancing trigger",
      details: "30% SUI → USDC",
      subdetails: "Rate: $1.24 / SUI",
      protocol: "DeepBook",
      time: "14:02 UTC",
      status: "success",
      isInternal: false
    },
    {
      id: "2",
      action: "Limit Order",
      subaction: "Strategy entry",
      details: "Buy 500 CETUS",
      subdetails: "Target: $0.15",
      protocol: "Cetus AMM",
      time: "13:45 UTC",
      status: "pending",
      isInternal: false
    },
    {
      id: "3",
      action: "Policy Update",
      subaction: "User override",
      details: "Max Slippage adjusted",
      subdetails: "From 0.5% to 1.0%",
      protocol: "Internal State",
      time: "11:30 UTC",
      status: "info",
      isInternal: true
    },
    {
      id: "4",
      action: "Execution Failed",
      subaction: "Insufficient balance",
      details: "Stake 100 SUI",
      subdetails: "Error: Balance < 100",
      protocol: "Sui Network",
      time: "09:12 UTC",
      status: "failed",
      isInternal: false
    }
  ]);

  const [skills, setSkills] = useState([
    {
      id: "auto-cancel",
      name: "Auto-Cancel Stale Orders",
      desc: "Reclaims funds if limit not hit in 1h",
      enabled: true
    },
    {
      id: "slippage",
      name: "Slippage Protection",
      desc: "Reverts if loss > 0.5%",
      enabled: true
    }
  ]);

  const toggleSkill = (id: string) => {
    setSkills((prev) =>
      prev.map((skill) =>
        skill.id === id ? { ...skill, enabled: !skill.enabled } : skill
      )
    );
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "success":
        return (
          <div className="w-9 h-9 rounded-full bg-[#E4F4EE] dark:bg-[#132D21] flex items-center justify-center flex-shrink-0">
            <img src="/assets/icons/check.svg" alt="Success" className="w-[16px] h-[18px]" />
          </div>
        );
      case "pending":
        return (
          <div className="w-9 h-9 rounded-full bg-[#ECECF9] dark:bg-[#1E293B] flex items-center justify-center flex-shrink-0">
            <img src="/assets/icons/limit_circle.svg" alt="Pending" className="w-[16px] h-[16px]" />
          </div>
        );
      case "failed":
        return (
          <div className="w-9 h-9 rounded-full bg-[#BA1A1A1A] dark:bg-[#3F1A1C] flex items-center justify-center flex-shrink-0">
            <img src="/assets/icons/warning.svg" alt="Failed" className="w-[16px] h-[16px]" />
          </div>
        );
      default:
        return (
          <div className="w-9 h-9 rounded-full bg-[#E8E8E8] dark:bg-zinc-800 flex items-center justify-center flex-shrink-0">
            <img src="/assets/icons/list.svg" alt="Info" className="w-[16px] h-[16px]" />
          </div>
        );
    }
  };

  return (
    <div className="flex h-full w-full bg-[#FAF9F6] dark:bg-[#262626] overflow-hidden font-sans transition-colors duration-200">
      
      {/* Left: Main Activity Log */}
      <div className="flex-1 flex flex-col h-full overflow-hidden bg-[#F7F7F5] dark:bg-[#262626] p-8">
        {/* Header section */}
        <div className="flex justify-between items-start mb-6">
          <div>
            <h1 className="text-[30px] font-bold text-zinc-900 dark:text-zinc-50 leading-tight">
              Activity Log
            </h1>
            <p className="text-[15px] text-[#5E5E5E] dark:text-zinc-400 mt-1">
              On-chain executions and agent operations
            </p>
          </div>

          <div className="flex gap-2">
            <button className="flex items-center gap-1.5 px-4.5 py-2 border-2 border-[#CFC4C5] dark:border-black bg-white dark:bg-[#2F2F2F] rounded-full text-[16px] font-semibold text-zinc-700 dark:text-zinc-300 shadow-[0_1px_2px_rgba(0,0,0,0.03)] hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer active:scale-95 transition-all">
              <MdFilterList className="text-[20px]" />
              Filter
            </button>
            <button className="flex items-center gap-1.5 px-4.5 py-2 border-2 border-[#CFC4C5] dark:border-black bg-white dark:bg-[#2F2F2F] rounded-full text-[16px] font-semibold text-zinc-700 dark:text-zinc-300 shadow-[0_1px_2px_rgba(0,0,0,0.03)] hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer active:scale-95 transition-all">
              <FiDownload className="text-[20px]" />
              Export
            </button>
          </div>
        </div>

        {/* Table Container Card */}
        <div className="bg-[#FAFAF9] dark:bg-[#2F2F2F] border border-[#FFFFFF99] dark:border-black rounded-[28px] shadow-[0_4px_24px_rgba(0,0,0,0.02)] overflow-hidden flex flex-col">
          {/* Table Header */}
          <div className="grid grid-cols-12 px-6 py-4 border-b border-[#F1F1EF] dark:border-zinc-850 text-[13px] font-mono font-bold text-[#5E5E5E] dark:text-zinc-450 bg-[#F3F2EF80] dark:bg-black/20">
            <div className="col-span-1" />
            <div className="col-span-3">Action</div>
            <div className="col-span-3">Details</div>
            <div className="col-span-2">Protocol</div>
            <div className="col-span-2">Time</div>
            <div className="col-span-1 text-right">Link</div>
          </div>

          {/* Table Rows */}
          <div className="divide-y divide-[#F1F1EF] dark:divide-zinc-850 font-geist">
            {activities.map((item) => {
              const hasDetail = item.id === "1";
              return (
              <div
                key={item.id}
                onClick={() => hasDetail && router.push(`/app/activities/${item.id}`)}
                className={`grid grid-cols-12 px-6 py-4 items-center hover:bg-zinc-50/40 dark:hover:bg-zinc-800/10 transition-all duration-150 ${hasDetail ? "cursor-pointer" : ""}`}
              >
                
                {/* Icon Column (no header) */}
                <div className="col-span-1 flex items-center">
                  {getStatusIcon(item.status)}
                </div>

                {/* Action Column */}
                <div className="col-span-3">
                  <div className={`text-[15px] font-normal ${item.status === "failed" ? "text-red-500" : "text-zinc-900 dark:text-zinc-100"}`}>
                    {item.action}
                  </div>
                  <div className="text-[12px] text-[#5E5E5E] dark:text-zinc-400 font-normal">
                    {item.subaction}
                  </div>
                </div>

                {/* Details Column */}
                <div className="col-span-3">
                  <div className="text-[15px] font-normal text-black dark:text-zinc-200">
                    {item.details}
                  </div>
                  <div className="text-[12px] text-[#5E5E5E] dark:text-zinc-450 font-normal">
                    {item.subdetails}
                  </div>
                </div>

                {/* Protocol Column */}
                <div className="col-span-2">
                  <span className={`text-[12px] font-semibold px-3 py-1.5 rounded-md ${
                    item.isInternal 
                      ? "text-[#5E5E5E] dark:text-zinc-400 bg-transparent font-normal" 
                      : "bg-[#E8E8E8] dark:bg-zinc-800 text-[#5E5E5E] dark:text-zinc-200 border border-[#E7E7E4] dark:border-zinc-700/60"
                  }`}>
                    {item.protocol}
                  </span>
                </div>

                {/* Time Column */}
                <div className="col-span-2 text-[13px] font-mono font-bold text-[#5E5E5E] dark:text-zinc-300">
                  {item.time}
                </div>

                {/* Link Column */}
                <div className="col-span-1 flex justify-end text-[#5E5E5E] dark:text-zinc-500">
                  {item.isInternal ? (
                    <MdLockOutline className="text-[20px] text-[#5E5E5E] dark:text-zinc-600" />
                  ) : (
                    <a href="#" className="hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors">
                      <RiShareBoxLine className="text-[20px]" />
                    </a>
                  )}
                </div>

              </div>
              );
            })}
          </div>

          {/* Table Footer */}
          <button className="w-full py-4 border-t border-[#E7E7E4] dark:border-zinc-850 text-[13px] font-normal text-[#5E5E5E] dark:text-zinc-400 flex items-center justify-center gap-1 hover:bg-zinc-50/20 dark:hover:bg-zinc-800/10 transition-all cursor-pointer font-geist">
            Load Older Activities
            <FiChevronDown />
          </button>
        </div>
      </div>

      {/* Vertical Divider Border that doesn't go all the way */}
      <div className="w-[1px] h-[92%] my-auto bg-[#E7E7E4] dark:bg-zinc-800 flex-shrink-0" />

      {/* Right: Policy/Agent Details Sidebar */}
      <div className="w-[360px] flex flex-col h-full overflow-y-auto bg-[#F3F2EF] dark:bg-[#242424] p-8 space-y-6">
        
        {/* Title */}
        <div className="flex justify-between items-start pt-2">
          <div>
            <h2 className="text-[20px] font-bold text-zinc-900 dark:text-zinc-50 leading-tight">
              Move Policy
            </h2>
            <p className="text-[14px] text-[#5E5E5E] dark:text-zinc-400 mt-0.5">
              Active constraints on Agent
            </p>
          </div>
          <button onClick={() => router.push("/app/activities/edit-policy")} className="flex items-center gap-1.5 px-3.5 py-1.5 border border-[#E7E7E4] dark:border-black bg-[#F3F2EF] dark:bg-[#2F2F2F] rounded-lg text-md font-medium text-[#5E5E5E] dark:text-zinc-300 shadow-[0_1px_2px_rgba(0,0,0,0.03)] hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer active:scale-95 transition-all">
            <FiEdit2 className="text-[15px]" />
            edit
          </button>
        </div>

        {/* Budget Allocation Card */}
        <div className="bg-white dark:bg-[#2F2F2F] border border-[#E7E7E4] dark:border-black rounded-[12px] p-5 shadow-sm space-y-4">
          <h3 className="text-[14px] font-bold text-[#5E5E5E] dark:text-zinc-400 tracking-wider">
            Budget Allocation
          </h3>
          {/* Progress bar */}
          <div className="w-full h-2.5 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
            <div className="h-full bg-zinc-950 dark:bg-zinc-50 rounded-full" style={{ width: "70%" }} />
          </div>
          {/* Numbers */}
          <div className="flex justify-between items-end">
            <div>
              <div className="text-[18px] font-bold text-zinc-900 dark:text-zinc-50">
                350 / 500 <span className="text-[18px] font-medium text-[#5E5E5E] dark:text-zinc-400">USDC</span>
              </div>
              <div className="text-[12px] font-semibold text-[#5E5E5E] dark:text-zinc-500 mt-6">
                Cumulative spent
              </div>
            </div>
            <div className="text-right">
              <div className="text-[12px] font-semibold text-[#5E5E5E] dark:text-zinc-500">
                Budget cap
              </div>
            </div>
          </div>
        </div>

        {/* Allowed Scope Card */}
        <div className="space-y-2">
          <h3 className="text-[17px] font-bold text-[#5E5E5E] dark:text-zinc-400">
            Allowed Scope
          </h3>

          <div className="space-y-3">
            <div className="text-[13px] font-semibold text-[#5E5E5E] dark:text-zinc-500">
              Assets
            </div>
            <div className="flex gap-2">
              <span className="relative pl-8 pr-3 py-2 bg-[#FAFAF9] dark:bg-zinc-900/40 border border-[#E7E7E4] dark:border-black rounded-2xl text-xs font-semibold text-black dark:text-zinc-300 shadow-sm flex items-center">
                <div className="absolute left-2.5 w-4 h-4 flex items-center justify-center">
                  <TokenSUI variant="background" size={16} className="rounded-full overflow-hidden" />
                </div>
                SUI
              </span>
              <span className="relative pl-8 pr-3 py-2 bg-[#FAFAF9] dark:bg-zinc-900/40 border border-[#E7E7E4] dark:border-black rounded-2xl text-xs font-semibold text-black dark:text-zinc-300 shadow-sm flex items-center">
                <div className="absolute left-2.5 w-4 h-4 flex items-center justify-center">
                  <TokenUSDC variant="branded" size={16} />
                </div>
                USDC
              </span>
            </div>
          </div>

          <div className="space-y-3 pt-4">
            <div className="text-[13px] font-bold text-[#5E5E5E] dark:text-zinc-500">
              Protocols
            </div>
            <div>
              <span className="relative pl-8 pr-3 py-2 bg-[#FAFAF9] dark:bg-zinc-900/40 border border-[#E7E7E4] dark:border-black rounded-2xl text-xs font-bold text-black dark:text-zinc-300 shadow-sm inline-flex items-center">
                <div className="absolute left-2.5 w-4 h-4 flex items-center justify-center">
                  <img src="/assets/icons/deepbook.png" alt="DeepBook" className="w-4 h-4 object-contain rounded" />
                </div>
                Deepbook CLOB
              </span>
            </div>
          </div>
        </div>

        {/* Auto-Revoke Timer Card */}
        <div className="bg-white dark:bg-[#2F2F2F] border-2 border-[#E7E7E4] dark:border-black rounded-[12px] p-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-[#EEEEEE] dark:bg-zinc-950 border border-[#E7E7E4] dark:border-black flex items-center justify-center text-zinc-700 dark:text-zinc-300 flex-shrink-0 shadow-sm">
            <IoMdStopwatch className="text-[26px]" />
          </div>
          <div>
            <div className="text-[16px] font-bold text-zinc-900 dark:text-zinc-50 font-mono">
              11h 45m
            </div>
            <div className="text-[15px] text-[#5E5E5E] dark:text-zinc-400 font-bold">
              Until Auto-Revoke
            </div>
          </div>
        </div>

        {/* Active Skills Card */}
        <div className="space-y-4">
          <h3 className="text-[12px] font-bold text-[#5E5E5E] dark:text-zinc-400 tracking-wider">
            Active Skills
          </h3>

          <div className="space-y-5">
            {skills.map((skill) => (
              <div key={skill.id} className="flex justify-between items-start gap-4">
                <div className="space-y-0.2">
                  <div className="text-[15px] font-bold text-zinc-900 dark:text-zinc-100">
                    {skill.name}
                  </div>
                  <div className="text-[13px] text-[#5E5E5E] dark:text-zinc-400 font-bold">
                    {skill.desc}
                  </div>
                </div>
                
                {/* Switch Toggle */}
                <button 
                  onClick={() => toggleSkill(skill.id)}
                  className={`w-10 h-5.5 rounded-full p-0.5 transition-all duration-200 focus:outline-none flex-shrink-0 cursor-pointer ${
                    skill.enabled 
                      ? "bg-zinc-950 dark:bg-zinc-50" 
                      : "bg-zinc-200 dark:bg-zinc-800"
                  }`}
                >
                  <div className={`w-4.5 h-4.5 rounded-full shadow-sm transition-all duration-200 transform ${
                    skill.enabled 
                      ? "translate-x-4.5 bg-white dark:bg-zinc-950" 
                      : "translate-x-0 bg-white dark:bg-zinc-400"
                  }`} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Footer Policy Shield */}
        <div className="-mx-8 -mb-8 mt-auto flex items-center justify-center gap-1.5 bg-[#FCFCFB] dark:bg-[#1E1E1E] border-t border-[#E7E7E4] dark:border-zinc-800 text-[#5E5E5E] dark:text-zinc-500 text-[12px] font-semibold py-4 px-8">
          <FiShield className="text-[13px]" />
          Policy Enforced On-Chain
        </div>

      </div>

    </div>
  );
}
