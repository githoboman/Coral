"use client";

import React, { useState, useRef, useEffect } from "react";
import { 
  FiChevronLeft, 
  FiArrowUp, 
  FiShield, 
  FiHexagon, 
  FiDollarSign,
  FiX
} from "react-icons/fi";
import { FiStopCircle } from "react-icons/fi";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { GoArrowUpRight } from "react-icons/go";

interface Message {
  id: string;
  sender: "user" | "agent";
  type: "text" | "strategy" | "executed";
  content?: string;
  data?: any;
}

const BotIcon = ({ className = "text-black", width = 30, height = 26 }: { className?: string; width?: number; height?: number }) => (
  <svg width={width} height={height} viewBox="0 0 30 26" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    <path d="M4 17.3333C2.88889 17.3333 1.94444 16.9444 1.16667 16.1667C0.388889 15.3889 0 14.4444 0 13.3333C0 12.2222 0.388889 11.2778 1.16667 10.5C1.94444 9.72222 2.88889 9.33333 4 9.33333V6.66667C4 5.93333 4.26111 5.30556 4.78333 4.78333C5.30556 4.26111 5.93333 4 6.66667 4H10.6667C10.6667 2.88889 11.0556 1.94444 11.8333 1.16667C12.6111 0.388889 13.5556 0 14.6667 0C15.7778 0 16.7222 0.388889 17.5 1.16667C18.2778 1.94444 18.6667 2.88889 18.6667 4H22.6667C23.4 4 24.0278 4.26111 24.55 4.78333C25.0722 5.30556 25.3333 5.93333 25.3333 6.66667V9.33333C26.4444 9.33333 27.3889 9.72222 28.1667 10.5C28.9444 11.2778 29.3333 12.2222 29.3333 13.3333C29.3333 14.4444 28.9444 15.3889 28.1667 16.1667C27.3889 16.9444 26.4444 17.3333 25.3333 17.3333V22.6667C25.3333 23.4 25.0722 24.0278 24.55 24.55C24.0278 25.0722 23.4 25.3333 22.6667 25.3333H6.66667C5.93333 25.3333 5.30556 25.0722 4.78333 24.55C4.26111 24.0278 4 23.4 4 22.6667V17.3333ZM10.6667 14.6667C11.2222 14.6667 11.6944 14.4722 12.0833 14.0833C12.4722 13.6944 12.6667 13.2222 12.6667 12.6667C12.6667 12.1111 12.4722 11.6389 12.0833 11.25C11.6944 10.8611 11.2222 10.6667 10.6667 10.6667C10.1111 10.6667 9.63889 10.8611 9.25 11.25C8.86111 11.6389 8.66667 12.1111 8.66667 12.6667C8.66667 13.2222 8.86111 13.6944 9.25 14.0833C9.63889 14.4722 10.1111 14.6667 10.6667 14.6667ZM18.6667 14.6667C19.2222 14.6667 19.6944 14.4722 20.0833 14.0833C20.4722 13.6944 20.6667 13.2222 20.6667 12.6667C20.6667 12.1111 20.4722 11.6389 20.0833 11.25C19.6944 10.8611 19.2222 10.6667 18.6667 10.6667C18.1111 10.6667 17.6389 10.8611 17.25 11.25C16.8611 11.6389 16.6667 12.1111 16.6667 12.6667C16.6667 13.2222 16.8611 13.6944 17.25 14.0833C17.6389 14.4722 18.1111 14.6667 18.6667 14.6667ZM9.33333 20H20V17.3333H9.33333V20Z" fill="currentColor"/>
  </svg>
);

export default function ChatPage() {
  const [isOpen, setIsOpen] = useState(false);
  const [shouldRender, setShouldRender] = useState(isOpen);
  
  const drawerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [typingMessage, setTypingMessage] = useState("");
  const [step, setStep] = useState(0); // 0: initial, 1: strategy parsed, 2: transaction executed

  useEffect(() => {
    if (isOpen) setShouldRender(true);
  }, [isOpen]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  useGSAP(() => {
    if (isOpen && drawerRef.current) {
      gsap.to(drawerRef.current, {
        width: 320,
        opacity: 1,
        duration: 0.4,
        ease: "power3.out",
      });
    } else if (!isOpen && drawerRef.current) {
      gsap.to(drawerRef.current, {
        width: 0,
        opacity: 0,
        duration: 0.4,
        ease: "power3.in",
        onComplete: () => setShouldRender(false),
      });
    }
  }, [isOpen, shouldRender]);

  const handleSend = (textToSend?: string) => {
    const text = textToSend || inputValue;
    if (!text.trim()) return;

    // Add user message
    const userMsg: Message = {
      id: Date.now().toString(),
      sender: "user",
      type: "text",
      content: text
    };
    setMessages((prev) => [...prev, userMsg]);
    setInputValue("");

    // Trigger typing simulation
    setIsTyping(true);
    setTypingMessage("Agent is parsing strategy...");

    // After 1.5s, render response
    setTimeout(() => {
      setIsTyping(false);
      
      const isTarget = text.toLowerCase().includes("swap 30%") && text.toLowerCase().includes("deepbook");
      
      if (isTarget) {
        const strategyMsg: Message = {
          id: (Date.now() + 1).toString(),
          sender: "agent",
          type: "strategy",
          data: {
            trigger: "SUI Price > $4.50",
            action: "Deepbook Swap",
            amount: "30% SUI Balance",
            pair: "SUI/USDC"
          }
        };
        setMessages((prev) => [...prev, strategyMsg]);
        setStep(1);
      } else {
        // Fallback agent message
        const fallbackMsg: Message = {
          id: (Date.now() + 1).toString(),
          sender: "agent",
          type: "text",
          content: "I have parsed your prompt. However, to see the custom interactive 1:1 strategy demo, please try inputting the exact string: \n\"Swap 30% SUI to USDC if SUI > $4.50 via Deepbook.\""
        };
        setMessages((prev) => [...prev, fallbackMsg]);
      }
    }, 1500);
  };

  const handleConfirm = () => {
    setIsTyping(true);
    setTypingMessage("Executing transaction via Deepbook V3...");
    
    setTimeout(() => {
      setIsTyping(false);
      const executedMsg: Message = {
        id: Date.now().toString(),
        sender: "agent",
        type: "executed",
        data: {
          time: "14:02 UTC",
          details: {
            title: "Swap SUI/USDC",
            sub: "Deepbook V3 • 14:02:45 UTC",
            amount: "150.0 SUI → 675.0 USDC"
          }
        }
      };
      setMessages((prev) => [...prev, executedMsg]);
      setStep(2);
    }, 1200);
  };

  const suggestions = [
    {
      category: "Swap",
      icon: (
        <img 
          src="/assets/icons/swap.svg" 
          alt="Swap" 
          width={20} 
          height={20} 
          className="object-contain flex-shrink-0"
        />
      ),
      text: "Swap 30% SUI to USDC if SUI > $4.50 via Deepbook."
    },
    {
      category: "Limit Order",
      icon: (
        <img 
          src="/assets/icons/limit.svg" 
          alt="Limit Order" 
          width={20} 
          height={20} 
          className="object-contain flex-shrink-0"
        />
      ),
      text: "Set a limit order for 500 CETUS at $0.15"
    },
    {
      category: "Stake",
      icon: (
        <img 
          src="/assets/icons/stake.svg" 
          alt="Stake" 
          width={20} 
          height={20} 
          className="object-contain flex-shrink-0"
        />
      ),
      text: "Stake 100 SUI to the network"
    },
    {
      category: "Analyze",
      icon: (
        <img 
          src="/assets/icons/analyze.svg" 
          alt="Analyze" 
          width={20} 
          height={20} 
          className="object-contain flex-shrink-0"
        />
      ),
      text: "Show my portfolio performance"
    }
  ];

  return (
    <div className="flex h-full w-full bg-[#FAF9F6] dark:bg-[#262626] overflow-hidden font-sans p-4 gap-4 transition-colors duration-200">
      
      {/* Left Chat Area */}
      <div className="flex-1 flex flex-col h-full relative overflow-hidden">
        
        {/* Top Controls */}
        <div className="flex justify-end pt-2 pr-4 h-[34px] z-10">
          {!shouldRender && (
            <button 
              onClick={() => setIsOpen(true)}
              className="flex items-center gap-1 px-3 py-4 border border-[#E7E7E4] dark:border-black rounded-full text-xs font-medium text-black dark:text-zinc-400 bg-[#F3F2EF] dark:bg-[#2F2F2F] shadow-[0_1px_2px_rgba(0,0,0,0.05)] hover:bg-zinc-50 dark:hover:bg-zinc-900 active:scale-[0.98] transition-all cursor-pointer"
            >
              <FiChevronLeft className="text-xl" />
              View active rule
            </button>
          )}
        </div>

        {/* Main Chat Core */}
        <div className="flex-1 overflow-y-auto px-6 pb-32 pt-4 flex flex-col">
          {messages.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center max-w-[720px] mx-auto w-full">
              {/* Robot Indicator */}
              <div className="w-[64px] h-[64px] bg-[#F3F2EF] dark:bg-[#2F2F2F] rounded-2xl flex items-center justify-center shadow-[0_1px_2px_rgba(0,0,0,0.05)] mb-4 border border-[#E7E7E4] dark:border-black">
                <BotIcon className="text-zinc-800 dark:text-zinc-200 flex-shrink-0" width={34} height={38} />
              </div>

              {/* Hello Text */}
              <h2 className="text-[18px] font-medium text-zinc-800 dark:text-zinc-200 text-center mb-8">
                How can Corral help you on-chain today?
              </h2>

              {/* Suggestions Grid */}
              <div className="grid grid-cols-2 gap-3.5 w-full">
                {suggestions.map((item, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSend(item.text)}
                    className="bg-white dark:bg-zinc-900/40 border border-[#E7E7E4] dark:border-zinc-800/80 rounded-2xl p-5 text-left transition-all hover:bg-zinc-50/50 hover:border-zinc-300 dark:hover:bg-zinc-900 dark:hover:border-zinc-700 cursor-pointer active:scale-[0.99] flex flex-col gap-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.03)]"
                  >
                    <span className="flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400 text-[14px] font-thin tracking-wider">
                      {item.icon}
                      {item.category}
                    </span>
                    <span className="text-black dark:text-zinc-100 font-medium text-[15px] leading-snug">
                      {item.text}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="max-w-[720px] w-full mx-auto space-y-6 flex-1 flex flex-col justify-start">
              {messages.map((msg) => (
                <div key={msg.id} className="w-full flex flex-col">
                  {msg.sender === "user" ? (
                    <div className="flex justify-end w-full mb-2">
                      <div className="bg-[#F4F4F3] dark:bg-[#2F2F2F] border border-[#E7E7E4] dark:border-black text-zinc-900 dark:text-zinc-100 px-6 py-3.5 rounded-[24px] rounded-tr-none text-[15px] font-normal max-w-[85%] shadow-sm">
                        {msg.content}
                      </div>
                    </div>
                  ) : (
                    <div className="w-full space-y-4">
                      {msg.type === "text" && (
                        <div className="flex items-start gap-3">
                          <div className="w-8 h-8 rounded-xl bg-[#F3F2EF] dark:bg-zinc-900 flex items-center justify-center border border-[#E7E7E4] dark:border-zinc-800 flex-shrink-0">
                            <BotIcon className="text-zinc-600 dark:text-zinc-400 flex-shrink-0" width={16} height={16} />
                          </div>
                          <div className="bg-white dark:bg-[#2F2F2F] border border-[#E7E7E4] dark:border-black text-zinc-900 dark:text-zinc-100 px-5 py-3 rounded-2xl text-[14px] whitespace-pre-line shadow-sm max-w-[85%]">
                            {msg.content}
                          </div>
                        </div>
                      )}

                      {msg.type === "strategy" && (
                        <div className="bg-white dark:bg-[#2F2F2F] border border-[#E7E7E4] dark:border-black rounded-[28px] p-6 shadow-[0_4px_24px_rgba(0,0,0,0.02)] max-w-full w-full">
                          {/* Header */}
                          <div className="flex items-center gap-2 mb-5">
                            <span className="w-8 h-8 flex items-center justify-center flex-shrink-0">
                              <img 
                                src="/assets/icons/bot_blue.svg" 
                                alt="Bot" 
                                width={28} 
                                height={28} 
                                className="object-contain flex-shrink-0"
                              />
                            </span>
                            <span className="text-[16px] font-bold text-zinc-900 dark:text-zinc-100">
                              Strategy Parsed
                            </span>
                          </div>

                          {/* Trigger table */}
                          <div className="bg-[#F7F7F5] dark:bg-[#262626] border border-[#E7E7E4] dark:border-black rounded-[20px] p-5 space-y-3 font-sans">
                            <div className="flex items-center justify-between text-[14px]">
                              <span className="text-[#5E5E5E] dark:text-zinc-500 font-medium">Trigger:</span>
                              <span className="font-mono font-bold text-zinc-800 dark:text-zinc-200">{msg.data.trigger}</span>
                            </div>
                            <div className="flex items-center justify-between text-[14px]">
                              <span className="text-[#5E5E5E] dark:text-zinc-500 font-medium">Action:</span>
                              <span className="font-mono font-bold text-zinc-800 dark:text-zinc-200">{msg.data.action}</span>
                            </div>
                            <div className="flex items-center justify-between text-[14px]">
                              <span className="text-[#5E5E5E] dark:text-zinc-500 font-medium">Amount:</span>
                              <span className="font-mono font-bold text-zinc-800 dark:text-zinc-200">{msg.data.amount}</span>
                            </div>
                            <div className="flex items-center justify-between text-[14px]">
                              <span className="text-[#5E5E5E] dark:text-zinc-500 font-medium">Pair:</span>
                              <span className="font-mono font-bold text-zinc-800 dark:text-zinc-200">{msg.data.pair}</span>
                            </div>
                          </div>

                          <div className="border-t border-[#E7E7E4] dark:border-zinc-800 my-5" />

                          {/* Checklists */}
                          <div className="space-y-3 mb-6">
                            <div className="flex items-center gap-2.5 text-zinc-700 dark:text-zinc-300 font-mono text-[13px] font-semibold">
                              <img 
                                src="/assets/icons/check.svg" 
                                alt="Check" 
                                width={20} 
                                height={20} 
                                className="flex-shrink-0"
                              />
                              BUDGET CHECK [OK]
                            </div>
                            <div className="flex items-center gap-2.5 text-zinc-700 dark:text-zinc-300 font-mono text-[13px] font-semibold">
                              <img 
                                src="/assets/icons/check.svg" 
                                alt="Check" 
                                width={20} 
                                height={20} 
                                className="flex-shrink-0"
                              />
                              ASSET WHITELIST [OK]
                            </div>
                            <div className="flex items-center gap-2.5 text-zinc-700 dark:text-zinc-300 font-mono text-[13px] font-semibold">
                              <img 
                                src="/assets/icons/check.svg" 
                                alt="Check" 
                                width={20} 
                                height={20} 
                                className="flex-shrink-0"
                              />
                              PROTOCOL SAFETY [OK]
                            </div>
                          </div>

                          {/* Action Buttons */}
                          {step === 1 && (
                            <div className="grid grid-cols-3 gap-3">
                              <button 
                                onClick={handleConfirm}
                                className="bg-black text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200 rounded-full py-3.5 text-center font-medium shadow-[0_1px_2px_rgba(0,0,0,0.05)] cursor-pointer transition-all active:scale-[0.98]"
                              >
                                Confirm
                              </button>
                              <button 
                                className="bg-white border border-[#E7E7E4] hover:bg-zinc-50 dark:bg-zinc-900 dark:border-zinc-850 dark:hover:bg-zinc-800 text-black dark:text-zinc-100 rounded-full py-3.5 text-center font-medium shadow-[0_1px_2px_rgba(0,0,0,0.05)] cursor-pointer transition-all active:scale-[0.98]"
                              >
                                Edit
                              </button>
                              <button 
                                className="bg-white border border-[#E7E7E4] hover:bg-red-50/10 dark:bg-zinc-900 dark:border-zinc-850 dark:hover:bg-zinc-800 rounded-full py-3.5 text-center font-medium text-red-500 shadow-[0_1px_2px_rgba(0,0,0,0.05)] cursor-pointer transition-all active:scale-[0.98]"
                              >
                                Cancel
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      {msg.type === "executed" && (
                        <div className="w-full">
                          {/* Divider */}
                          <div className="relative flex items-center justify-center my-6">
                            <div className="absolute inset-0 flex items-center">
                              <div className="w-full border-t border-[#E7E7E4] dark:border-zinc-800"></div>
                            </div>
                            <span className="relative bg-[#FAF9F6] dark:bg-[#262626] px-4 text-[11px] font-mono font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest">
                              TRANSACTION EXECUTED AT {msg.data.time}
                            </span>
                          </div>

                          {/* Tx Success Card */}
                          <div className="bg-white dark:bg-[#2F2F2F] border border-[#E7E7E4] dark:border-black rounded-2xl p-4 shadow-[0_2px_8px_rgba(0,0,0,0.02)] flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-full bg-[#E5F5EF] dark:bg-[#132D21] flex items-center justify-center text-[#10B981] dark:text-[#34A853] flex-shrink-0">
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                                </svg>
                              </div>
                              <div>
                                <div className="text-[14px] font-bold text-zinc-900 dark:text-zinc-100 leading-tight">
                                  {msg.data.details.title}
                                </div>
                                <div className="text-[12px] font-bold text-[#5E5E5E] dark:text-zinc-550 mt-0.5">
                                  {msg.data.details.sub}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-4">
                              <div className="text-[13px] font-mono font-bold text-zinc-800 dark:text-zinc-200">
                                {msg.data.details.amount}
                              </div>
                              <span className="bg-[#E6F5EC] dark:bg-[#122A1E] text-[#10B981] dark:text-[#34D399] px-2.5 py-0.5 rounded-md text-xs font-bold">
                                Success
                              </span>
                              <a href="#" className="flex items-center gap-1.5 text-[#4F46E5] hover:text-[#4338CA] dark:text-[#818CF8] dark:hover:text-[#6366F1] text-[13px] font-bold ml-2 transition-all">
                                View TX
                                <GoArrowUpRight className="w-3.5 h-3.5" />
                              </a>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {/* Typing simulation bubble */}
              {isTyping && (
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-[#F3F2EF] dark:bg-zinc-900 flex items-center justify-center border border-[#E7E7E4] dark:border-zinc-800 flex-shrink-0">
                    <BotIcon className="text-zinc-600 dark:text-zinc-400 flex-shrink-0" width={16} height={16} />
                  </div>
                  <div className="bg-white dark:bg-[#2F2F2F] border border-[#E7E7E4] dark:border-black text-zinc-900 dark:text-zinc-100 px-5 py-3.5 rounded-2xl shadow-sm max-w-[85%] flex items-center gap-3">
                    <span className="text-[14px] text-zinc-500 dark:text-zinc-400 font-medium">
                      {typingMessage}
                    </span>
                    <div className="flex gap-1 items-center">
                      <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 dark:bg-zinc-500 animate-bounce" style={{ animationDelay: "0ms" }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 dark:bg-zinc-500 animate-bounce" style={{ animationDelay: "150ms" }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 dark:bg-zinc-500 animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Floating Input Area */}
        <div className="absolute bottom-2 left-0 right-0 px-6 flex justify-center bg-gradient-to-t from-[#FAF9F6] via-[#FAF9F6]/90 to-transparent dark:from-[#262626] dark:via-[#262626]/90 pt-8 pb-2">
          <form 
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="flex items-center justify-between w-full max-w-[720px] bg-white dark:bg-[#1C1C1C] border border-[#E7E7E4] dark:border-transparent rounded-full pl-6 pr-2.5 py-2.5 shadow-[0_4px_16px_rgba(0,0,0,0.03)] dark:shadow-none focus-within:border-zinc-300 focus-within:ring-1 focus-within:ring-zinc-200 dark:focus-within:border-transparent dark:focus-within:ring-0 transition-all"
          >
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Instruct the agent..."
              className="bg-transparent border-0 outline-none w-full text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-650 text-[0.92rem] pr-4"
            />
            <button 
              type="submit"
              className="bg-zinc-950 dark:bg-zinc-50 text-white dark:text-zinc-950 rounded-full w-[38px] h-[38px] flex items-center justify-center hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-all cursor-pointer active:scale-[0.95] flex-shrink-0"
            >
              <FiArrowUp className="text-[1.15rem]" />
            </button>
          </form>
        </div>

      </div>

      {/* Active Rule Side Drawer */}
      {shouldRender && (
        <div 
          ref={drawerRef}
          className="h-full bg-[#F3F2EF] dark:bg-zinc-900 border border-[#E7E7E4] dark:border-zinc-800 shadow-[0_10px_40px_rgba(0,0,0,0.04)] flex flex-col justify-between rounded-[2.2rem] overflow-hidden opacity-0 z-10"
          style={{ width: 0 }}
        >
          <div className="w-[300px] md:w-[320px] pt-[32px] pr-[17px] pb-[20px] pl-[32px] h-full flex flex-col justify-between flex-shrink-0">
            <div>
              {/* Header */}
              <div className="flex items-center justify-between mb-8">
                <h3 className="text-[20px] font-semibold flex items-center gap-2 text-zinc-900 dark:text-zinc-50">
                  <FiShield className="text-zinc-800 dark:text-zinc-200" />
                  Policy Constraints
                </h3>
                <button 
                  onClick={() => setIsOpen(false)}
                  className="w-8 h-8 rounded-full bg-[#F3F2EF] dark:bg-zinc-800 flex items-center justify-center border border-[#E7E7E4] dark:border-zinc-700 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 cursor-pointer shadow-sm active:scale-95 transition-all"
                >
                  <FiX />
                </button>
              </div>

              {/* Drawer Content Sections */}
              <div className="space-y-6">
                
                {/* Budget Usage */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[0.74rem] font-thin text-black dark:text-zinc-500 tracking-wider">
                      Budget Usage
                    </span>
                    <span className="text-[0.85rem] font-mono font-bold text-zinc-900 dark:text-zinc-100">
                      45%
                    </span>
                  </div>
                  {/* Progress Bar */}
                  <div className="w-full h-2 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
                    <div className="h-full bg-zinc-950 dark:bg-zinc-50 rounded-full" style={{ width: "45%" }} />
                  </div>
                  {/* Bottom details */}
                  <div className="text-[12px] font-mono text-black/50 dark:text-zinc-400 mt-2 font-bold text-center">
                    450 SUI Used / 1,000 SUI Max Spend
                  </div>
                </div>

                {/* Protocol Whitelist */}
                <div>
                  <h4 className="text-[0.74rem] font-thin text-black dark:text-zinc-500 tracking-wider mb-2">
                    Protocol Whitelist
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    <span className="flex items-center gap-1.5 bg-white dark:bg-zinc-800/50 border border-[#E7E7E4] dark:border-zinc-700/80 rounded-lg px-3 py-2 text-xs font-medium text-zinc-700 dark:text-zinc-300 shadow-sm">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]" />
                      Deepbook V3
                    </span>
                    <span className="flex items-center gap-1.5 bg-white dark:bg-zinc-800/50 border border-[#E7E7E4] dark:border-zinc-700/80 rounded-lg px-3 py-2 text-xs font-medium text-zinc-700 dark:text-zinc-300 shadow-sm">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]" />
                      Cetus
                    </span>
                  </div>
                </div>

                {/* Asset Whitelist */}
                <div>
                  <h4 className="text-[0.74rem] font-thin text-black dark:text-zinc-500 tracking-wider mb-2">
                    Asset Whitelist
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    <span className="flex items-center gap-1.5 bg-white dark:bg-zinc-800/50 border border-[#E7E7E4] dark:border-zinc-700/80 rounded-lg px-3 py-2 text-xs font-semibold text-zinc-700 dark:text-zinc-300 shadow-sm">
                      <FiHexagon className="text-zinc-500 dark:text-zinc-400 text-[0.8rem]" />
                      SUI
                    </span>
                    <span className="flex items-center gap-1.5 bg-white dark:bg-zinc-800/50 border border-[#E7E7E4] dark:border-zinc-700/80 rounded-lg px-3 py-2 text-xs font-semibold text-zinc-700 dark:text-zinc-300 shadow-sm">
                      <FiDollarSign className="text-zinc-500 dark:text-zinc-400 text-[0.8rem]" />
                      USDC
                    </span>
                  </div>
                </div>

                {/* Time Constraint */}
                <div>
                  <h4 className="text-[0.74rem] font-thin text-black dark:text-zinc-500 tracking-wider mb-2">
                    Time Constraint
                  </h4>
                  <div className="bg-white dark:bg-zinc-900/60 border border-[#E7E7E4] dark:border-zinc-800 rounded-2xl p-4 shadow-sm flex flex-col gap-6">
                    <div className="flex items-center justify-between text-xs font-medium">
                      <span className="text-black dark:text-zinc-500">Expires</span>
                      <span className="font-mono font-bold text-zinc-900 dark:text-zinc-100">
                        2024-05-20 16:14 UTC
                      </span>
                    </div>
                    <div className="text-[0.74rem] font-normal text-red-500 dark:text-red-400">
                      Agent session ends in 2h 14m
                    </div>
                  </div>
                </div>

              </div>
            </div>

            {/* Bottom Actions */}
            <div>
              <button 
                onClick={() => {
                  alert("Agent access revoked successfully.");
                  setIsOpen(false);
                }}
                className="flex items-center justify-center gap-2 w-full border border-red-500 dark:border-red-600/80 bg-[#F3F2EF]  hover:bg-red-50/10 active:scale-[0.98] transition-all rounded-full py-3.5 text-red-600 dark:text-red-400 font-normal text-[0.88rem] cursor-pointer shadow-sm"
              >
                <FiStopCircle className="text-[20px] " />
                Revoke agent access
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
