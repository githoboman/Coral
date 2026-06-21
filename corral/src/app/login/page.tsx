"use client";

import { MdOutlineAccountBalanceWallet } from "react-icons/md";
import { FcGoogle } from "react-icons/fc";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    router.push("/app/chat");
  };

  return (
    <div className="flex h-screen w-full flex-row bg-white font-sans dark:bg-zinc-950 transition-colors duration-200 overflow-hidden">
      {/* Left side: Login Card Section */}
      <div className="flex w-full flex-col justify-center px-6 py-12 lg:w-[45%] lg:px-12 xl:px-24">
        <div className="mx-auto w-full max-w-[440px] rounded-[2.2rem] border border-zinc-100 bg-white p-10 shadow-[0_8px_30px_rgb(0,0,0,0.02)] dark:border-zinc-900 dark:bg-zinc-900/50">
          
          {/* Logo & Title */}
          <div>
            <h1 className="text-[2.6rem] font-bold tracking-tight text-zinc-900 dark:text-zinc-50 leading-none">
              Corral
            </h1>
            <p className="mt-4 text-[1rem] font-normal leading-relaxed text-[#5E5E5E] dark:text-zinc-400">
              Get access to an autonomous and secure agentic workflow onchain
            </p>
          </div>

          {/* Social Sign In Buttons */}
          <div className="mt-8 flex flex-col gap-3">
            <button className="flex h-[50px] w-full items-center justify-center gap-2 rounded-full border border-zinc-200/80 bg-white text-[0.92rem] font-bold text-zinc-800 transition-all hover:bg-zinc-50 active:scale-[0.98] dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800/80 cursor-pointer">
              <MdOutlineAccountBalanceWallet className="text-xl text-zinc-600 dark:text-zinc-400" />
              Connect Wallet
            </button>
            <button className="flex h-[50px] w-full items-center justify-center gap-2 rounded-full border border-zinc-200/80 bg-white text-[0.92rem] font-bold text-zinc-800 transition-all hover:bg-zinc-50 active:scale-[0.98] dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800/80 cursor-pointer">
              <FcGoogle className="text-xl" />
              Continue with Google
            </button>
          </div>

          {/* OR Divider */}
          <div className="relative flex items-center justify-center my-7">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-zinc-100 dark:border-zinc-800/60"></div>
            </div>
            <span className="relative bg-white px-4 text-[0.75rem] font-bold tracking-widest text-[#5E5E5E] dark:bg-zinc-900 dark:text-zinc-500 uppercase">
              OR
            </span>
          </div>

          {/* Form Fields */}
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            {/* Email Address */}
            <div className="flex flex-col gap-2">
              <label className="text-[0.7rem] font-bold tracking-widest text-[#5E5E5E] dark:text-zinc-500 uppercase">
                Email Address
              </label>
              <input
                type="email"
                placeholder="name@domain.com"
                className="h-[52px] w-full rounded-2xl border-0 bg-[#F3F2EF] px-5 text-[0.92rem] text-zinc-900 placeholder-zinc-400 outline-none transition-all focus:bg-zinc-100/80 focus:ring-1 focus:ring-zinc-200 dark:bg-zinc-900/60 dark:text-zinc-50 dark:placeholder-zinc-600 dark:focus:bg-zinc-900 dark:focus:ring-zinc-800"
              />
            </div>

            {/* Password */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label className="text-[0.7rem] font-bold tracking-widest text-[#5E5E5E] dark:text-zinc-500 uppercase">
                  Password
                </label>
                <a
                  href="#"
                  className="text-[0.78rem] font-bold text-[#5E5E5E] hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300 transition-colors"
                >
                  Forgot?
                </a>
              </div>
              <input
                type="password"
                placeholder="••••••••"
                className="h-[52px] w-full rounded-2xl border-0 bg-[#F3F2EF] px-5 text-[0.92rem] text-zinc-900 placeholder-zinc-400 outline-none transition-all focus:bg-zinc-100/80 focus:ring-1 focus:ring-zinc-200 dark:bg-zinc-900/60 dark:text-zinc-50 dark:placeholder-zinc-600 dark:focus:bg-zinc-900 dark:focus:ring-zinc-800"
              />
            </div>

            {/* Sign In Button */}
            <button
              type="submit"
              className="mt-2 flex h-[42px] w-full items-center justify-center rounded-full bg-zinc-950 text-[0.95rem] font-bold text-white transition-all hover:bg-zinc-800 active:scale-[0.98] dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200 cursor-pointer"
            >
              Sign In
            </button>
          </form>

        </div>
      </div>

      {/* Right side: Background Image Section */}
      <div
        className="hidden lg:block lg:flex-1 bg-cover bg-center opacity-40"
        style={{ backgroundImage: "url('/assets/images/login_bg.png')" }}
      />
    </div>
  );
}
