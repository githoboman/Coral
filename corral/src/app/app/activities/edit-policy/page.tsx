"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { IoIosArrowBack } from "react-icons/io";
import { FiX, FiPlus, FiCalendar } from "react-icons/fi";
import { MdOutlineAccountBalanceWallet } from "react-icons/md";
import { IoTimerOutline } from "react-icons/io5";
import { MdOutlineEditCalendar } from "react-icons/md";
import { MdAccountBalanceWallet } from "react-icons/md";
import { IoMdStopwatch } from "react-icons/io";


export default function EditPolicyPage() {
  const router = useRouter();
  const [budgetCap, setBudgetCap] = useState("5000.00");
  const [tokens, setTokens] = useState(["SUI", "USDC"]);
  const [protocols, setProtocols] = useState(["Deepbook CLOB"]);

  const removeToken = (t: string) => setTokens((prev) => prev.filter((x) => x !== t));
  const removeProtocol = (p: string) => setProtocols((prev) => prev.filter((x) => x !== p));

  return (
    <div className="h-full w-full overflow-y-auto bg-[#F7F7F5] dark:bg-[#262626] font-sans transition-colors duration-200">
      <div className="w-full px-6 py-8">

        {/* Back + Title */}
        <div className="mb-8">
          <div className="flex items-center gap-1">
            <button
              onClick={() => router.back()}
              className="flex items-center justify-center w-9 h-9 text-[#5E5E5E] dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-all cursor-pointer active:scale-95 flex-shrink-0"
              title="Go back"
            >
              <IoIosArrowBack className="text-[22px]" />
            </button>
            <h1 className="text-[26px] font-bold text-zinc-900 dark:text-zinc-50 leading-tight">
              Rules Configuration
            </h1>
          </div>
          <p className="text-[13px] text-[#5E5E5E] dark:text-zinc-400 mt-1 max-w-[520px] pl-10">
            Configure the on-chain Move Policy Object. These constraints dictate the operational boundaries of your autonomous agent.
          </p>
        </div>

        {/* Two-column layout */}
        <div className="flex gap-6 items-start px-16">

          {/* Left — main config */}
          <div className="flex-1 space-y-5">

            {/* Budget Constraints */}
            <div className="bg-white dark:bg-[#2F2F2F] border border-[#FFFFFF99] dark:border-black rounded-[20px] p-6 shadow-sm">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2.5">
                  <MdAccountBalanceWallet className="text-[22px] text-zinc-700 dark:text-zinc-300" />
                  <h2 className="text-[25px] font-bold text-zinc-900 dark:text-zinc-50">Budget Constraints</h2>
                </div>
                <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-[#E8E8E8] dark:bg-zinc-800 border border-[#E7E7E4] dark:border-zinc-700 text-[#5E5E5E] dark:text-zinc-400">
                  On-Chain Enforced
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-5">
                {/* Max Budget Cap */}
                <div>
                  <label className="text-[13px] font-semibold text-[#5E5E5E] dark:text-zinc-400 tracking-wider block mb-2">
                    Maximum Budget Cap (USDC)
                  </label>
                  <div className="flex items-center gap-2 bg-white dark:bg-zinc-900/40 border border-[#6B7280] dark:border-zinc-700 rounded-xl px-4 py-3">
                    <input
                      type="text"
                      value={budgetCap}
                      onChange={(e) => setBudgetCap(e.target.value)}
                      className="flex-1 bg-transparent text-[15px] font-mono font-semibold text-zinc-900 dark:text-zinc-100 outline-none"
                    />
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 16 16"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                      className="text-black dark:text-zinc-500 flex-shrink-0"
                    >
                      <path
                        d="M1.5 16C1.0875 16 0.734375 15.8531 0.440625 15.5594C0.146875 15.2656 0 14.9125 0 14.5V3.5C0 3.08181 0.145833 2.72375 0.4375 2.42583C0.729167 2.12806 1.08333 1.98611 1.5 2H8.70833L7.20833 3.5H1.5V14.5H12.5V8.79167L14 7.29167V14.5C14 14.9125 13.8531 15.2656 13.5594 15.5594C13.2656 15.8531 12.9125 16 12.5 16H1.5ZM5 11V7.8125L12.375 0.4375C12.5278 0.284722 12.6944 0.173611 12.875 0.104167C13.0556 0.0347222 13.2396 0 13.4271 0C13.6271 0 13.8177 0.0347222 13.999 0.104167C14.1802 0.173611 14.3468 0.283195 14.4988 0.432917L15.5625 1.5C15.7153 1.65278 15.8264 1.81944 15.8958 2C15.9653 2.18056 16 2.36806 16 2.5625C16 2.75694 15.9651 2.94507 15.8954 3.12688C15.8257 3.30854 15.7147 3.47458 15.5625 3.625L8.1875 11H5ZM6.5 9.5H7.5625L12.375 4.6875L11.8542 4.14583L11.3125 3.625L6.5 8.4375V9.5Z"
                        fill="currentColor"
                      />
                    </svg>
                  </div>
                </div>

                {/* Current Utilization */}
                <div>
                  <label className="text-[13px] font-semibold text-[#5E5E5E] dark:text-zinc-400 tracking-wider block mb-2">
                    Current Utilization
                  </label>
                  <div className="flex items-center bg-[#EEEEEE] dark:bg-zinc-900/40 border border-[#E7E7E4] dark:border-zinc-700 rounded-xl px-4 py-3">
                    <span className="text-[15px] font-mono font-semibold text-zinc-900 dark:text-zinc-100">
                      1,250.00
                    </span>
                    <span className="text-[13px] text-[#5E5E5E] dark:text-zinc-400 ml-1.5">/ 5000.00 USDC</span>
                  </div>
                </div>
              </div>

              {/* Budget Consumption bar */}
              <div>
                <div className="flex justify-between mb-1.5">
                  <span className="text-[12px] font-semibold text-[#5E5E5E] dark:text-zinc-400">Budget Consumption</span>
                  <span className="text-[12px] font-bold text-zinc-900 dark:text-zinc-100 font-mono">25%</span>
                </div>
                <div className="h-2 w-full bg-[#EEEEEE] dark:bg-zinc-800 rounded-full overflow-hidden">
                  <div className="h-full w-[25%] bg-zinc-900 dark:bg-zinc-100 rounded-full" />
                </div>
              </div>
            </div>

            {/* Operational Whitelist */}
            <div className="bg-white dark:bg-[#2F2F2F] border border-[#FFFFFF99] dark:border-black rounded-[20px] p-6 shadow-sm">
              <div className="flex items-center gap-2.5 mb-2">
                <svg
                  width="20"
                  height="17"
                  viewBox="0 0 20 17"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className="text-black dark:text-zinc-300 flex-shrink-0"
                >
                  <path
                    d="M12.4 16.075L11 14.675L13.6 12.075L11 9.475L12.4 8.075L15 10.675L17.6 8.075L19 9.475L16.4 12.075L19 14.675L17.6 16.075L15 13.475L12.4 16.075ZM14.375 7.075L10.825 3.525L12.225 2.125L14.35 4.25L18.6 0L20 1.425L14.375 7.075ZM0 13.075V11.075H9V13.075H0ZM0 5.075V3.075H9V5.075H0Z"
                    fill="currentColor"
                  />
                </svg>
                <h2 className="text-[25px] font-bold text-zinc-900 dark:text-zinc-50">Operational Whitelist</h2>
              </div>
              <p className="text-[15px] font-medium text-[#5E5E5E] dark:text-zinc-400 mb-5">
                Assets and protocols not explicitly listed here are mathematically blocked by the Move contract.
              </p>

              {/* Allowed Tokens */}
              <div className="mb-5">
                <label className="text-[12px] font-semibold text-[#5E5E5E] dark:text-zinc-400 block mb-2.5">
                  Allowed Tokens
                </label>
                <div className="flex flex-wrap gap-2">
                  {tokens.map((t) => (
                    <span key={t} className="flex items-center gap-1.5 px-3 py-1.5 bg-[#FAFAF9] dark:bg-zinc-900/40 border border-[#E7E7E4] dark:border-zinc-700 rounded-full text-[13px] font-semibold text-zinc-800 dark:text-zinc-200">
                      <span className="w-2 h-2 rounded-full bg-[#10B981] flex-shrink-0" />
                      {t}
                      <button onClick={() => removeToken(t)} className="text-[#5E5E5E] hover:text-red-500 transition-colors cursor-pointer ml-0.5">
                        <FiX className="text-[12px]" />
                      </button>
                    </span>
                  ))}
                  <button className="flex items-center justify-center w-8 h-8 rounded-full border border-dashed border-[#C8C8C5] dark:border-zinc-600 text-[#5E5E5E] dark:text-zinc-400 hover:border-zinc-400 hover:text-zinc-700 transition-all cursor-pointer">
                    <FiPlus className="text-[14px]" />
                  </button>
                </div>
              </div>

              {/* Target Protocols */}
              <div>
                <label className="text-[12px] font-semibold text-[#5E5E5E] dark:text-zinc-400 block mb-2.5">
                  Target Protocols
                </label>
                <div className="flex flex-wrap gap-2">
                  {protocols.map((p) => (
                    <span key={p} className="flex items-center gap-2 px-3 py-1.5 bg-[#FAFAF9] dark:bg-zinc-900/40 border border-[#E7E7E4] dark:border-zinc-700 rounded-full text-[13px] font-semibold text-zinc-800 dark:text-zinc-200">
                      {p === "Deepbook CLOB" ? (
                        <svg
                          width="15"
                          height="14"
                          viewBox="0 0 15 14"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                          className="flex-shrink-0 text-zinc-800 dark:text-zinc-200"
                        >
                          <path
                            d="M9.75 13.5V11.25H6.75V3.75H5.25V6H0V0H5.25V2.25H9.75V0H15V6H9.75V3.75H8.25V9.75H9.75V7.5H15V13.5H9.75ZM1.5 1.5V4.5V1.5ZM11.25 9V12V9ZM11.25 1.5V4.5V1.5ZM11.25 4.5H13.5V1.5H11.25V4.5ZM11.25 12H13.5V9H11.25V12ZM1.5 4.5H3.75V1.5H1.5V4.5Z"
                            fill="currentColor"
                          />
                        </svg>
                      ) : (
                        <span className="w-2 h-2 rounded-full bg-[#3B82F6] flex-shrink-0" />
                      )}
                      {p}
                      <button onClick={() => removeProtocol(p)} className="text-[#5E5E5E] hover:text-red-500 transition-colors cursor-pointer ml-0.5">
                        <FiX className="text-[12px]" />
                      </button>
                    </span>
                  ))}
                  <button className="flex items-center justify-center w-8 h-8 rounded-full border border-dashed border-[#C8C8C5] dark:border-zinc-600 text-[#5E5E5E] dark:text-zinc-400 hover:border-zinc-400 hover:text-zinc-700 transition-all cursor-pointer">
                    <FiPlus className="text-[14px]" />
                  </button>
                </div>
              </div>
            </div>

          </div>

          {/* Right sidebar */}
          <div className="w-[280px] flex-shrink-0 space-y-20">

            {/* Time Lock Expiry */}
            <div className="bg-white dark:bg-[#2F2F2F] border border-[#FFFFFF99] dark:border-black rounded-[20px] p-5 shadow-sm space-y-4">
              <div className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300">
                <IoMdStopwatch className="text-[25px]" />
                <span className="text-[18px] font-bold">Time Lock Expiry</span>
              </div>

              <div>
                <div className="text-[14px] font-semibold text-[#5E5E5E] dark:text-zinc-400 mb-2">
                  Expiration Timestamp
                </div>
                <div className="flex items-center justify-center gap-2 bg-white dark:bg-zinc-900/40 border border-[#6B7280] dark:border-zinc-700 rounded-xl px-3 py-2.5">
                  <span className="text-[15px] font-geist text-black dark:text-zinc-100">12/31/2024, 11:59 PM</span>
                  <MdOutlineEditCalendar className="text-black dark:text-white text-[16px] flex-shrink-0" />
                </div>
              </div>

              <div className="flex flex-col items-center justify-center bg-[#F3F2EF] dark:bg-zinc-900/40 rounded-xl px-4 py-3 gap-4">
                <div className="text-[11px] font-semibold text-[#5E5E5E] dark:text-zinc-400 tracking-wider">
                  Time Remaining
                </div>
                <span className="text-[28px] font-bold text-zinc-900 dark:text-zinc-50 font-geist leading-none">
                  14d 08h 42m
                </span>
              </div>
            </div>

            {/* Security Controls */}
            <div className="bg-[#FF595B0D] dark:bg-[#2A1A1A] border border-[#FECACA] dark:border-[#7F1D1D] rounded-[20px] p-5 shadow-sm space-y-3">
              <div className="flex items-center gap-2 text-[#FF595B]">
                <svg
                  width="16"
                  height="20"
                  viewBox="0 0 16 20"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className="flex-shrink-0"
                >
                  <path
                    d="M8 20C5.68333 19.4167 3.77083 18.0875 2.2625 16.0125C0.754167 13.9375 0 11.6333 0 9.1V3L8 0L16 3V9.1C16 11.6333 15.2458 13.9375 13.7375 16.0125C12.2292 18.0875 10.3167 19.4167 8 20ZM8 17.9C9.61667 17.4 10.9667 16.4125 12.05 14.9375C13.1333 13.4625 13.7667 11.8167 13.95 10H8V2.125L2 4.375V9.1C2 9.28333 2 9.43333 2 9.55C2 9.66667 2.01667 9.81667 2.05 10H8V17.9Z"
                    fill="currentColor"
                  />
                </svg>
                <span className="text-[16px] font-bold">Security Controls</span>
              </div>
              <p className="text-[12px] text-[#5E5E5E] dark:text-red-300/70 leading-relaxed">
                Clicking this button will block all future agent actions including scheduled ones, and current pending executions
              </p>
              <button className="w-full flex items-center justify-center gap-2 py-3 bg-[#FF595B] hover:bg-[#D93025] text-white text-[14px] font-semibold rounded-xl transition-all cursor-pointer active:scale-95 shadow-sm">
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 20 20"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className="flex-shrink-0 text-white"
                >
                  <path
                    d="M10 20C8.61667 20 7.31667 19.7375 6.1 19.2125C4.88333 18.6875 3.825 17.975 2.925 17.075C2.025 16.175 1.3125 15.1167 0.7875 13.9C0.2625 12.6833 0 11.3833 0 10C0 8.6 0.2625 7.29583 0.7875 6.0875C1.3125 4.87917 2.025 3.825 2.925 2.925L4.325 4.325C3.59167 5.05833 3.02083 5.90833 2.6125 6.875C2.20417 7.84167 2 8.88333 2 10C2 12.2333 2.775 14.125 4.325 15.675C5.875 17.225 7.76667 18 10 18C12.2333 18 14.125 17.225 15.675 15.675C17.225 14.125 18 12.2333 18 10C18 8.88333 17.7958 7.84167 17.3875 6.875C16.9792 5.90833 16.4083 5.05833 15.675 4.325L17.075 2.925C17.975 3.825 18.6875 4.87917 19.2125 6.0875C19.7375 7.29583 20 8.6 20 10C20 11.3833 19.7375 12.6833 19.2125 13.9C18.6875 15.1167 17.975 16.175 17.075 17.075C16.175 17.975 15.1167 18.6875 13.9 19.2125C12.6833 19.7375 11.3833 20 10 20ZM9 11V0H11V11H9Z"
                    fill="currentColor"
                  />
                </svg>
                Revoke Agent Access
              </button>
            </div>

          </div>
        </div>

        {/* Bottom Action Bar */}
        <div className="flex items-center justify-end gap-4 mt-8 pt-6 border-t border-[#E7E7E4] dark:border-zinc-800 px-16">
          <button
            onClick={() => router.back()}
            className="flex items-center justify-center px-5 py-2.5 border-3 border-[#E7E7E4] dark:border-black dark:border-zinc-850 rounded-full bg-transparent text-[14px] font-semibold text-[#FF595B] hover:bg-[#FF595B0D] cursor-pointer transition-all active:scale-95"
          >
            Discard Changes
          </button>
          <button className="flex items-center gap-2 px-5 py-2.5 bg-zinc-950 dark:bg-zinc-50 text-white dark:text-zinc-950 text-[14px] font-semibold rounded-full hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-all cursor-pointer active:scale-95 shadow-sm">
            <svg
              width="15"
              height="15"
              viewBox="0 0 15 15"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="flex-shrink-0"
            >
              <path
                d="M7.5 15V12.6938L11.6438 8.56875C11.7563 8.45625 11.8813 8.375 12.0188 8.325C12.1562 8.275 12.2937 8.25 12.4312 8.25C12.5812 8.25 12.725 8.27813 12.8625 8.33438C13 8.39062 13.125 8.475 13.2375 8.5875L13.9312 9.28125C14.0312 9.39375 14.1094 9.51875 14.1656 9.65625C14.2219 9.79375 14.25 9.93125 14.25 10.0688C14.25 10.2063 14.225 10.3469 14.175 10.4906C14.125 10.6344 14.0437 10.7625 13.9312 10.875L9.80625 15H7.5ZM13.125 10.0688L12.4312 9.375L13.125 10.0688ZM8.625 13.875H9.3375L11.6062 11.5875L11.2688 11.2312L10.9125 10.8938L8.625 13.1625V13.875ZM1.5 15C1.0875 15 0.734375 14.8531 0.440625 14.5594C0.146875 14.2656 0 13.9125 0 13.5V1.5C0 1.0875 0.146875 0.734375 0.440625 0.440625C0.734375 0.146875 1.0875 0 1.5 0H7.5L12 4.5V6.75H10.5V5.25H6.75V1.5H1.5V13.5H6V15H1.5ZM11.2688 11.2312L10.9125 10.8938L11.6062 11.5875L11.2688 11.2312Z"
                fill="currentColor"
              />
            </svg>
            Update Policy
          </button>
        </div>

      </div>
    </div>
  );
}
