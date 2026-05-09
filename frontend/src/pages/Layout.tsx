import { Outlet, useLocation, Link } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import { HiArrowSmallRight } from 'react-icons/hi2';
import { RiDiscordLine, RiTwitterXLine, RiMenu3Fill } from 'react-icons/ri';
import { PiTelegramLogo } from "react-icons/pi";
import { IoClose } from 'react-icons/io5';
import Lenis from 'lenis';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const LandingPageLayout = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [showAnnouncement] = useState(false); // Set to true to show the "V2 is live" banner
  const location = useLocation();

  // Set to false to show Coming Soon screen; change to true when ready to launch
  
  const menuRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isMenuOpen) {
      // Open animation
      gsap.fromTo(backdropRef.current,
        { opacity: 0 },
        { opacity: 1, duration: 0.3, ease: "power2.out" }
      );
      gsap.fromTo(menuRef.current,
        { height: 0, opacity: 0, y: -20 },
        { height: "auto", opacity: 1, y: 0, duration: 0.4, ease: "power3.out" }
      );
    }
  }, [isMenuOpen]);

  const closeMenu = () => {
    gsap.to(menuRef.current, {
      height: 0,
      opacity: 0,
      y: -20,
      duration: 0.3,
      ease: "power3.in",
      onComplete: () => setIsMenuOpen(false)
    });
    gsap.to(backdropRef.current, {
      opacity: 0,
      duration: 0.3,
      ease: "power2.in"
    });
  };

  const toggleMenu = () => {
    if (isMenuOpen) {
      closeMenu();
    } else {
      setIsMenuOpen(true);
    }
  };

  useEffect(() => {
    const lenis = new Lenis({
      duration: 1.2,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      orientation: 'vertical',
      gestureOrientation: 'vertical',
      smoothWheel: true,
    });

    lenis.on('scroll', ScrollTrigger.update);

    gsap.ticker.add((time) => {
      lenis.raf(time * 1000);
    });

    gsap.ticker.lagSmoothing(0);

    return () => {
      lenis.destroy();
    };
  }, []);
  const navigationItems = [
    { name: 'About', to: '#about' },
    { name: 'Product', to: '#Product' },
  ];



  return (
    <main className="bg-transparent text-white flex flex-col min-h-screen max-w-screen overflow-hidden">
      {/* HEADER */}
      <header className="fixed top-4 md:top-6 left-1/2 -translate-x-1/2 z-[100] w-[95%] max-w-6xl border border-white/10 bg-transparent/80 backdrop-blur-md rounded-4xl shadow-2xl transition-all duration-300">
        <div className="px-2 sm:px-4 py-2">
          <div className="flex justify-between items-center">
            {/* Logo */}
            <div className="flex items-center pl-2">
              <Link to="/" className="flex items-center hover:opacity-80 transition-opacity duration-200">
                <img
                  src="/assets/images/v2/logo-primary.png"
                  alt="Tovira Logo"
                  className="h-[14px] md:h-[16px] mr-2"
                />
                <h1 className="text-base sm:text-xl font-bold text-white tracking-tight">
                  Tovira
                </h1>
              </Link>
            </div>

            {/* Desktop Navigation & CTA */}
            <div className="hidden md:flex items-center space-x-8">
              <nav>
                <ul className="flex items-center space-x-8">
                  {navigationItems.map((item) => (
                    <li key={item.name}>
                      <a
                        href={item.to}
                        className={`text-[13px] font-medium transition-colors duration-200 hover:text-white ${location.pathname === item.to
                          ? 'text-white'
                          : 'text-white/60'
                          }`}
                      >
                        {item.name}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>

              <a
                href="https://testnet.tovira.xyz"
                className="bg-[#2563eb] hover:bg-[#3b82f6] text-white  py-2.5 px-8 rounded-full transition-all duration-200 text-[13px] shadow-lg hover:shadow-blue-500/20 whitespace-nowrap"
              >
                Launch Testnet
              </a>
            </div>

            {/* Mobile menu button & CTA */}
            <div className="md:hidden flex items-center gap-2 pr-2">
              <a
                href="https://testnet.tovira.xyz"
                className="bg-[#326AFD] hover:bg-[#2855D1] text-white py-2 px-4 rounded-full transition-all duration-200 text-[10px] font-semibold whitespace-nowrap shadow-lg shadow-[#326AFD]/10"
              >
                Launch Testnet
              </a>
              <button
                onClick={toggleMenu}
                className="p-2 rounded-full hover:bg-white/5 focus:outline-none text-white flex items-center justify-center relative z-[110]"
              >
                <span className="sr-only">Toggle menu</span>
                {isMenuOpen ? (
                  <IoClose className="h-6 w-6" />
                ) : (
                  <RiMenu3Fill className="h-6 w-6" />
                )}
              </button>
            </div>
          </div>

        </div>

        {/* ANNOUNCEMENT BANNER */}
        {showAnnouncement && (
          <div className="absolute top-[calc(100%-1px)] left-1/2 -translate-x-1/2 z-[70]">
            <a 
              href="#announcement"
              className="flex items-center gap-1.5 md:gap-2 bg-[#B7FC0D33] backdrop-blur-md px-3 md:px-4 py-1 rounded-b-xl hover:bg-[#252500] transition-all group shadow-lg whitespace-nowrap"
            >
              <span className="text-[9px] md:text-[10px] font-medium text-[#B7FC0D] tracking-wide">
                V2 is live. View announcement post
              </span>
              <HiArrowSmallRight className="w-2.5 h-2.5 md:w-3 md:h-3 text-[#B7FC0D] group-hover:translate-x-0.5 transition-transform" />
            </a>
          </div>
        )}
      </header>

      {/* Global Mobile Navigation Menu Backdrop & Content */}
      {isMenuOpen && (
        <>
          {/* Backdrop blurring the entire app content */}
          <div 
            ref={backdropRef}
            className="fixed inset-0 bg-black/60 backdrop-blur-md z-[80] md:hidden"
            onClick={closeMenu}
          />
          {/* Menu items positioned relative to header */}
          <div 
            ref={menuRef} 
            className="fixed top-20 left-1/2 -translate-x-1/2 w-[95%] max-w-6xl z-[85] md:hidden overflow-hidden mobile-menu-container"
          >
            <div className="bg-[#050505]/95 backdrop-blur-xl rounded-2xl border border-white/5 p-4 shadow-2xl mx-2">
              <ul className="flex flex-col space-y-3">
                {navigationItems.map((item) => (
                  <li key={item.name}>
                    <a
                      href={item.to}
                      className={`block py-2 px-3 text-sm font-medium transition-colors duration-200 hover:bg-white/5 rounded-lg ${location.pathname === item.to
                        ? 'text-white'
                        : 'text-white/70'
                        }`}
                      onClick={closeMenu}
                    >
                      {item.name}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </>
      )}



      {/* Main Content */}
      <div className="flex-1">
        <Outlet />
      </div>

      {/* Footer Section */}
      <footer className="relative bg-transparent pt-10 md:pt-16 overflow-hidden border-t border-white/5">
        <div className="max-w-[1600px] mx-auto px-6 md:px-12 relative z-10">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 md:gap-10 mb-8 md:mb-12">
            {/* Logo and Tagline Column */}
            <div className="flex flex-col items-start">
              <div className="flex items-center gap-3 mb-3 md:mb-8">
                <img src="/assets/images/v2/logo-primary.png" alt="Tovira Logo" className="h-4" />
                <span className="text-2xl font-semibold tracking-tight text-white">Tovira</span>
              </div>
              <p className="text-white text-xs md:text-sm leading-relaxed mb-6 md:mb-10">
                Get Access to specialized crypto workflow tools across research, analysis and monitoring.
              </p>
              <a href="https://testnet.tovira.xyz" className="inline-block bg-[#326AFD] hover:bg-[#2855D1] text-white px-4 py-3 md:px-8 md:py-3.5 rounded-full text-xs font-medium transition-all shadow-lg shadow-[#326AFD]/10">
                Try Tovira on Testnet
              </a>
            </div>

            {/* Links Columns */}
            <div className="lg:col-span-3 grid grid-cols-2 md:grid-cols-3 gap-6 md:gap-8">
              <div className="flex flex-col items-start md:items-center lg:items-center">
                <div className="text-left">
                  <h4 className="text-xl font-medium mb-3 lg:mb-8 text-white">Company</h4>
                  <ul className="space-y-4 text-white/80 text-xs text-left">
                    <li><a href="#" className="hover:text-white transition-colors">About</a></li>
                    <li><a href="#" className="hover:text-white transition-colors">Product</a></li>
                    <li><a href="#" className="hover:text-white transition-colors">Brand kit</a></li>
                  </ul>
                </div>
              </div>
              <div className="flex flex-col items-start md:items-center lg:items-center">
                <div className="text-left">
                  <h4 className="text-xl font-medium mb-3 lg:mb-8 text-white">Compliance</h4>
                  <ul className="space-y-4 text-white/80 text-xs text-left">
                    <li><a href="#" className="hover:text-white transition-colors">Terms of use</a></li>
                    <li><a href="#" className="hover:text-white transition-colors">Privacy Policy</a></li>
                  </ul>
                </div>
              </div>
              <div className="flex flex-col items-start md:items-center lg:items-end col-span-2 md:col-span-1 mt-4 md:mt-0">
                <div className="text-left md:text-left lg:text-right">
                  <h4 className="text-xl font-medium mb-6 lg:mb-8 text-white">Contact</h4>
                  <div className="flex flex-col items-start md:items-start lg:items-end gap-4 md:gap-6 lg:gap-8">
                    <a href="mailto:hello@tovira.xyz" className="text-white/80 hover:text-white transition-colors text-sm">
                      hello@tovira.xyz
                    </a>
                    <div className="flex items-center gap-6 lg:gap-8">
                      <a href="#" className="text-white/80 hover:text-white transition-all hover:scale-110">
                        <RiDiscordLine className="w-6 h-6" />
                      </a>
                      <a href="#" className="text-white/80 hover:text-white transition-all hover:scale-110">
                        <PiTelegramLogo className="w-5 h-5" />
                      </a>
                      <a href="#" className="text-white/80 hover:text-white transition-all hover:scale-110">
                        <RiTwitterXLine className="w-5 h-5" />
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Large Watermark - Controlled Height Section */}
        <div className="relative w-full h-[220px] md:h-[32vw] select-none pointer-events-none opacity-15 overflow-hidden -mt-4 md:-mt-16 -mb-4 md:-mb-10">
          <h1 className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-[140px] md:text-[34vw] font-semibold tracking-tighter text-white/60 leading-none text-center whitespace-nowrap w-full flex justify-center">
            Tovira
          </h1>
        </div>

        <div className="max-w-7xl mx-auto px-6 relative z-10">
          {/* Copyright Bar */}
          <div className="flex justify-center md:justify-end pb-8">
            <p className="text-white/60 text-[10px] md:text-xs tracking-wider">
              © 2025 Tovira. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </main>
  );
};

export default LandingPageLayout;