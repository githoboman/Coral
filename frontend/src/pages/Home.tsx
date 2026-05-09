import React, { useState, useRef } from 'react';
import { motion, Variants, AnimatePresence } from 'framer-motion';
import { FiSearch, FiArrowUp } from 'react-icons/fi';
import { LuMousePointerClick } from "react-icons/lu";
import { IoClose } from 'react-icons/io5';
import { FcGoogle } from 'react-icons/fc';
import { SiSui } from 'react-icons/si';
import 'react-toastify/dist/ReactToastify.css';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';

gsap.registerPlugin(ScrollTrigger);
ScrollTrigger.normalizeScroll(true);
ScrollTrigger.config({ ignoreMobileResize: true });


const agentData = [
  {
    id: 'tovira',
    name: 'Tovira AI',
    subtitle: 'Ask and explore crypto topics',
    mascot: '/assets/images/v2/agent.png',
    chatLink: 'Chat with Tovira',
    chatPrompt: 'What is sui blockchain?',
    chatResponse: "Here's a breakdown of SUI blockchain",
  },
  {
    id: 'task',
    name: 'Task Agent',
    subtitle: 'Create and manage personal tasks',
    mascot: '/assets/images/v2/task.png',
    chatLink: 'Chat with agent',
    chatPrompt: 'Remind me to try out tovira v3 in 5 minutes',
    chatResponse: 'Setting a reminder...',
  },
  {
    id: 'eva',
    name: 'Eva Agent',
    subtitle: 'Bridge assets to and from SUI',
    mascot: '/assets/images/v2/eva.png',
    chatLink: 'Chat with eva',
    chatPrompt: 'bridge half my ETH to SUI',
    chatResponse: 'Bridging ETH to SUI...',
  },
  {
    id: 'research',
    name: 'Research Agent',
    subtitle: 'Break down tokens and market data',
    mascot: '/assets/images/v2/research.png',
    chatLink: 'Chat with agent',
    chatPrompt: 'What is SUI Deepbook?',
    chatResponse: "Here's a detailed report on SUI Deepbook",
  },
];

const Home: React.FC = () => {
 
  const [activeAgentIdx, setActiveAgentIdx] = useState(0);
  const [showScrollTop, setShowScrollTop] = useState(false);

  const containerVariants: Variants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.2,
      },
    },
  };

  const itemVariants: Variants = {
    hidden: { opacity: 0, y: 20 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: 0.5,
      },
    },
  };

  const heroRef = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    const isMobileDevice = window.innerWidth < 768;
    let mm = gsap.matchMedia();

    mm.add("(max-width: 767px)", () => {
      // Mobile - Mascots swoop into view with flair
      gsap.to(".mascot-left", {
        xPercent: 150,
        yPercent: -120,
        rotate: 45,
        scale: 1.2,
        opacity: 1,
        scrollTrigger: {
          trigger: heroRef.current,
          start: "top top",
          end: "bottom center",
          scrub: 1,
        }
      });

      gsap.to(".mascot-right", {
        xPercent: -150,
        yPercent: 120,
        rotate: -45,
        scale: 1.2,
        opacity: 1,
        scrollTrigger: {
          trigger: heroRef.current,
          start: "top top",
          end: "bottom center",
          scrub: 1,
        }
      });
    });

    mm.add("(min-width: 768px)", () => {
      // Desktop - Dramatic exit
      gsap.to(".mascot-left", {
        xPercent: -150,
        yPercent: 100,
        rotate: -90,
        scale: 0.5,
        opacity: 0,
        scrollTrigger: {
          trigger: heroRef.current,
          start: "top top",
          end: "bottom center",
          scrub: 1,
        }
      });

      gsap.to(".mascot-right", {
        xPercent: 150,
        yPercent: -100,
        rotate: 90,
        scale: 0.5,
        opacity: 0,
        scrollTrigger: {
          trigger: heroRef.current,
          start: "top top",
          end: "bottom center",
          scrub: 1,
        }
      });
    });

    // Macbook Section Animation
    gsap.from(".macbook-container", {
      y: 100,
      opacity: 0,
      scale: 0.9,
      scrollTrigger: {
        trigger: ".macbook-section",
        start: "top 80%",
        end: "top 20%",
        scrub: 1,
      }
    });

    gsap.from(".interface-text", {
      x: -100,
      opacity: 0,
      scrollTrigger: {
        trigger: ".macbook-section",
        start: "top 70%",
        end: "top 30%",
        scrub: 1,
      }
    });

    gsap.from(".agents-text", {
      x: 100,
      opacity: 0,
      scrollTrigger: {
        trigger: ".macbook-section",
        start: "top 70%",
        end: "top 30%",
        scrub: 1,
      }
    });
    // Agents Section Animation removed to avoid conflict with Framer Motion

    // Portfolio Section Animation (Scrubbed)
    gsap.from(".portfolio-reveal-up", {
      y: 100,
      opacity: 0,
      scrollTrigger: {
        trigger: ".portfolio-reveal-up",
        start: "top 95%",
        end: "top 40%",
        scrub: isMobileDevice ? false : 1,
        toggleActions: isMobileDevice ? "play none none none" : undefined,
      }
    });

    gsap.from(".portfolio-reveal-left", {
      x: -100,
      opacity: 0,
      scrollTrigger: {
        trigger: ".portfolio-reveal-left",
        start: "top 85%",
        end: "top 35%",
        scrub: isMobileDevice ? false : 1,
        toggleActions: isMobileDevice ? "play none none none" : undefined,
      }
    });

    gsap.from(".portfolio-reveal-right", {
      x: 100,
      opacity: 0,
      scrollTrigger: {
        trigger: ".portfolio-reveal-right",
        start: "top 85%",
        end: "top 35%",
        scrub: isMobileDevice ? false : 1,
        toggleActions: isMobileDevice ? "play none none none" : undefined,
      }
    });
    // Alert Section Animation (Scrubbed)
    gsap.from(".alert-reveal-left", {
      x: -100,
      opacity: 0,
      scrollTrigger: {
        trigger: ".alert-reveal-left",
        start: "top 85%",
        end: "top 35%",
        scrub: isMobileDevice ? false : 1,
        toggleActions: isMobileDevice ? "play none none none" : undefined,
      }
    });

    gsap.from(".alert-reveal-right", {
      x: 100,
      opacity: 0,
      scrollTrigger: {
        trigger: ".alert-reveal-right",
        start: "top 85%",
        end: "top 35%",
        scrub: isMobileDevice ? false : 1,
        toggleActions: isMobileDevice ? "play none none none" : undefined,
      }
    });

    // Task Section Animation (Scrubbed)
    gsap.from(".task-reveal-left", {
      x: -100,
      opacity: 0,
      scrollTrigger: {
        trigger: ".task-reveal-left",
        start: "top 85%",
        end: "top 35%",
        scrub: isMobileDevice ? false : 1,
        toggleActions: isMobileDevice ? "play none none none" : undefined,
      }
    });

    gsap.from(".task-reveal-right", {
      x: 100,
      opacity: 0,
      scrollTrigger: {
        trigger: ".task-reveal-right",
        start: "top 85%",
        end: "top 35%",
        scrub: isMobileDevice ? false : 1,
        toggleActions: isMobileDevice ? "play none none none" : undefined,
      }
    });
    // Notifications Section Animation (Scrubbed)
    gsap.from(".notif-reveal-up", {
      y: 100,
      opacity: 0,
      scrollTrigger: {
        trigger: ".notif-reveal-up",
        start: "top 95%",
        end: "top 40%",
        scrub: isMobileDevice ? false : 1,
        toggleActions: isMobileDevice ? "play none none none" : undefined,
      }
    });

    gsap.from(".notif-reveal-left", {
      x: -50,
      opacity: 0,
      scrollTrigger: {
        trigger: ".notif-reveal-left",
        start: "top 85%",
        end: "top 35%",
        scrub: isMobileDevice ? false : 1,
        toggleActions: isMobileDevice ? "play none none none" : undefined,
      }
    });

    gsap.from(".notif-reveal-right", {
      x: 50,
      opacity: 0,
      scrollTrigger: {
        trigger: ".notif-reveal-right",
        start: "top 85%",
        end: "top 35%",
        scrub: isMobileDevice ? false : 1,
        toggleActions: isMobileDevice ? "play none none none" : undefined,
      }
    });

    // Start Section Animation (Scrubbed)
    gsap.from(".start-reveal-up", {
      y: 100,
      opacity: 0,
      scrollTrigger: {
        trigger: ".start-reveal-up",
        start: "top 95%",
        end: "top 40%",
        scrub: isMobileDevice ? false : 1,
        toggleActions: isMobileDevice ? "play none none none" : undefined,
      }
    });

    gsap.utils.toArray(".start-reveal-mascot").forEach((el: any) => {
      gsap.from(el, {
        scale: 0.5,
        opacity: 0,
        rotate: -10,
        scrollTrigger: {
          trigger: el,
          start: "top 90%",
          end: "top 50%",
          scrub: isMobileDevice ? false : 1,
          toggleActions: isMobileDevice ? "play none none none" : undefined,
        }
      });
    });
  }, { scope: heroRef });

  useGSAP(() => {
    ScrollTrigger.create({
      trigger: ".hero-section",
      start: "bottom 80%",
      onEnter: () => setShowScrollTop(true),
      onLeaveBack: () => setShowScrollTop(false),
    });
  });

  useGSAP(() => {
    // Staggered reveal for agent card details
    gsap.from(".reveal-item", {
      opacity: 0,
      x: -20,
      duration: 0.5,
      stagger: 0.1,
      ease: "power2.out",
      clearProps: "all"
    });
  }, { dependencies: [activeAgentIdx], scope: heroRef });

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#010103]" ref={heroRef}>
      <section className="relative min-h-[25rem] md:min-h-[45rem] flex items-center justify-center overflow-hidden bg-[#010103] pt-24 md:pt-32 pb-0 hero-section">
        {/* Floating Mascots */}
        <img
          src="/assets/images/v2/research.png"
          alt="Mascot Research"
          className="mascot-left absolute -left-8 sm:-left-24 md:-left-32 lg:-left-12 bottom-[35%] md:bottom-20 w-18 sm:w-56 md:w-80 lg:w-[14rem] opacity-100 select-none pointer-events-none z-10"
        />
        <img
          src="/assets/images/v2/agent.png"
          alt="Mascot Agent"
          className="mascot-right absolute -right-8 sm:-right-24 md:-right-32 lg:-right-20 top-[30%] md:top-[50%] -translate-y-1/2 w-18 sm:w-56 md:w-80 lg:w-[14rem] opacity-100 select-none pointer-events-none z-10"
        />

        <div className="w-full px-4 md:px-10 lg:px-20 relative z-20">
          <motion.div
            className="flex flex-col items-center justify-center max-w-none mx-auto text-center w-full px-4"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={containerVariants}
          >
            <motion.div variants={itemVariants} className="w-full">
              <motion.h1
                className="text-[25px] sm:text-5xl md:text-6xl lg:text-8xl font-[500] mb-5 md:mb-6 leading-[1.2] md:leading-[1.1] tracking-tight px-4"
                variants={itemVariants}
              >
                A <span className="text-[#B7FC0D]">smarter</span> way to handle <br className="block md:hidden" />crypto workflows
              </motion.h1>
              
              <motion.p
                className="text-[13px] sm:text-lg md:text-xl lg:text-2xl text-white/80 font-light mb-8 md:mb-10 max-w-[200%] mx-auto leading-relaxed px-6 md:px-4 "
                variants={itemVariants}
              >
                Tovira brings research, wallet analysis, tracking, and on-chain execution into <br className="hidden md:block" /> one connected product.
              </motion.p>

              <motion.div 
                className="flex flex-row items-center justify-center gap-4 md:gap-6 mt-4" 
                variants={itemVariants}
              >
                <a
                  href="#waitlist"
                  className="bg-[#326AFD] hover:bg-[#407BFF] text-white py-2.5 md:py-4 px-5 md:px-6 rounded-full font-medium transition-all duration-300 shadow-xl hover:shadow-[#326AFD]/20 hover:-translate-y-1 text-[11px] sm:text-sm text-center whitespace-nowrap"
                >
                  Get Started for free
                </a>
                <a
                  href="#how-it-works"
                  className="text-[#326AFD] hover:text-[#407BFF] font-medium transition-all duration-300 text-[11px] sm:text-sm md:text-base px-2 md:px-4 py-2 text-center whitespace-nowrap"
                >
                  See how it works
                </a>
              </motion.div>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Macbook Mockup Section */}
      <section className="macbook-section relative min-h-0 flex items-center justify-center bg-[#010103] pt-0 pb-20 overflow-hidden">
        <div className="w-full max-w-7xl mx-auto px-4 relative flex items-center justify-center">
          
          {/* Floating Text Left */}
          <div className="interface-text absolute left-3 md:left-0 lg:left-30 top-[30%] -translate-y-1/2 z-20">
            <h2 className="text-[18px] sm:text-[24px] md:text-[48px] tracking-tight font-medium md:font-normal">
              <span className="text-[#B7FC0D]">One</span> Interface
            </h2>
          </div>

          {/* Macbook Container */}
          <div className="macbook-container relative w-full max-w-6xl z-10 px-8 md:px-10 mt-8 md:mt-0">
            <div className="relative">
              <img 
                src="/assets/images/v2/mac_mockup.png" 
                alt="Macbook Mockup" 
                className="w-full h-auto relative z-10 scale-136 md:scale-100"
              />
            </div>
          </div>

          {/* Floating Text Right */}
          <div className="agents-text absolute right-3 md:right-0 lg:right-12 top-[65%] -translate-y-1/2 z-20">
            <h2 className="text-[18px] sm:text-[24px] md:text-[48px] tracking-tight text-right font-medium md:font-normal">
              <span className="text-[#326AFD]">Multiple</span> agents
            </h2>
          </div>

        </div>
      </section>

      {/* Agents Section */}
      <section className="agents-section relative bg-[#010103] py-24 overflow-hidden">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16 relative flex flex-col items-center">
            <h2 className="text-2xl md:text-5xl mb-6 tracking-tight">
              Switch between agents <span className="text-[#B7FC0D]">at the ready</span>
            </h2>
            <p className="text-white/60 text-sm md:text-xl font-light mb-8">
              Based on your current task, question, or work
            </p>
            <div className="hidden md:flex items-center justify-center gap-4 w-full max-w-sm mx-auto">
              <div className="h-px bg-white/20 flex-1"></div>
              <div className="flex items-center gap-2 text-white/50 text-xs font-medium tracking-widest">
                <span>Tap a card to Expand</span>
                <LuMousePointerClick className="w-4 h-4" />
              </div>
              <div className="h-px bg-white/20 flex-1"></div>
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 min-h-[300px] md:min-h-[380px] relative">
            {/* Left Arrow (Mobile only) */}
            <button 
              className="md:hidden absolute -left-6 sm:left-0 top-1/2 -translate-y-1/2 z-30 p-2 text-white/50 hover:text-white transition-colors"
              onClick={() => setActiveAgentIdx((prev) => (prev > 0 ? prev - 1 : agentData.length - 1))}
            >
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
              </svg>
            </button>

            {/* Right Arrow (Mobile only) */}
            <button 
              className="md:hidden absolute -right-6 sm:right-0 top-1/2 -translate-y-1/2 z-30 p-2 text-white/50 hover:text-white transition-colors"
              onClick={() => setActiveAgentIdx((prev) => (prev < agentData.length - 1 ? prev + 1 : 0))}
            >
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5l7 7-7 7" />
              </svg>
            </button>

            {/* Active / Expanded Card */}
            <motion.div
              key={agentData[activeAgentIdx].id}
              layoutId={`card-${agentData[activeAgentIdx].id}`}
              className="agent-card lg:col-span-6 w-full bg-[#0D0D10] border-2 border-white/20 rounded-[32px] px-5 py-6 md:px-6 md:py-8 relative cursor-default"
            >
              {/* Mascot — bleeds out top-right, z-0 */}
              <motion.div 
                layoutId={`mascot-container-${agentData[activeAgentIdx].id}`}
                className="absolute -top-10 md:-top-13 right-0 md:right-20 w-[40%] md:w-[40%] pointer-events-none z-0 translate-x-4 md:translate-x-8"
              >
                <motion.img
                  layoutId={`mascot-img-${agentData[activeAgentIdx].id}`}
                  src={agentData[activeAgentIdx].mascot}
                  alt={agentData[activeAgentIdx].name}
                  animate={{ opacity: 1 }}
                  className="w-full h-auto"
                />
              </motion.div>

              {/* Title + subtitle */}
              <div className="relative z-10 mb-4 md:mb-5 reveal-item">
                <h3 className="text-xl md:text-2xl mb-1 md:mb-2">{agentData[activeAgentIdx].name}</h3>
                <p className="text-white/80 text-[10px] md:text-sm max-w-[65%] md:max-w-none">{agentData[activeAgentIdx].subtitle}</p>
              </div>

              {/* Chat panel — left 58%, fixed height, z-20 above mascot */}
              <div className="relative z-20 w-[85%] sm:w-[80%] md:w-[58%] bg-[#090909] rounded-[24px] md:rounded-4xl border-2 border-white/20 p-3.5 md:p-5 min-h-[180px] md:min-h-[250px] flex flex-col reveal-item">
                <div className="flex justify-end mb-3 md:mb-6">
                  <div className="bg-[#326AFD] text-white text-[10px] md:text-[11px] py-1.5 md:py-2 px-4 md:px-5 rounded-full max-w-[85%] text-right leading-tight">
                    {agentData[activeAgentIdx].chatPrompt}
                  </div>
                </div>
                <div className="flex gap-2 md:gap-3 items-start mt-auto">
                  <img src={agentData[activeAgentIdx].mascot} className="w-5 h-5 md:w-6 md:h-6 mt-0.5 shrink-0" alt="" />
                  <div className="flex-1">
                    <span className="text-white/50 text-[10px] md:text-xs block mb-0.5 md:mb-1">Tovira</span>
                    <p className="text-white/90 text-[10px] md:text-xs mb-3 md:mb-4 leading-relaxed">{agentData[activeAgentIdx].chatResponse}</p>
                    <div className="h-2 md:h-3 w-full bg-white/40 rounded-full mb-3 md:mb-4" />
                    <div className="h-2 md:h-3 w-3/4 bg-white/40 rounded-full" />
                  </div>
                </div>
              </div>

              {/* Link */}
              <a
                href="#chat"
                className="absolute bottom-4 right-5 md:bottom-8 md:right-8 z-10 text-[#326AFD] text-[11px] md:text-sm hover:underline reveal-item"
              >
                {agentData[activeAgentIdx].chatLink}
              </a>
            </motion.div>

            {/* Compact Inactive Cards */}
            <div className="hidden lg:grid lg:col-span-6 grid-cols-3 gap-4">
              {agentData.map((agent, idx) => {
                if (idx === activeAgentIdx) return null;
                return (
                  <motion.div
                    key={agent.id}
                    layoutId={`card-${agent.id}`}
                    onClick={() => setActiveAgentIdx(idx)}
                    className="bg-[#0D0D10] border border-white/5 rounded-[28px] p-5 relative overflow-hidden flex flex-col cursor-pointer"
                  >
                    <div className="relative z-10">
                      <h3 className="text-base font-medium leading-tight">{agent.name.split(' ')[0]}</h3>
                      <p className="text-white">{agent.name.includes(' ') ? agent.name.split(' ').slice(1).join(' ') : 'Agent'}</p>
                    </div>
                    <motion.div 
                      layoutId={`mascot-container-${agent.id}`}
                      className="absolute top-0 right-0 w-[150%] h-full flex items-end -mr-45 mt-8"
                    >
                      <motion.img
                        layoutId={`mascot-img-${agent.id}`}
                        src={agent.mascot}
                        alt={agent.name}
                        animate={{ opacity: 0.5 }}
                        className="h-[35%] object-contain"
                      />
                    </motion.div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* portfolio Section */}
      <section className="portfolio-section relative bg-[#010103] pt-12 pb-8 md:py-24 overflow-hidden">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-10 portfolio-reveal-up">
            <h2 className="text-xl md:text-5xl font-medium mb-6 tracking-tight text-white">
              Move from <span className="text-[#326AFD]">interaction</span> to structured <span className="text-[#B7FC0D]">control</span>
            </h2>
            <p className="text-white text-md md:text-xl font-light">
              Wallet monitoring, tasks, and portfolio analysis are managed here
            </p>
          </div>

          <div className="flex flex-col lg:flex-row items-center gap-12 lg:gap-20">
            <div className="lg:w-1/2 portfolio-reveal-left text-center lg:text-left">
              <h3 className="text-xl md:text-4xl font-medium mb-4 md:mb-6 text-white">
                Portfolio <span className="text-[#B7FC0D]">dashboard</span>
              </h3>
              <p className="text-white text-xs sm:text-sm md:text-md mb-8 md:mb-20 max-w-md mx-auto lg:mx-0 leading-relaxed">
                Analyze wallet activity and holdings of your wallet or any other on SUI blockchain
              </p>

              <div className="flex flex-row items-center justify-center lg:justify-start gap-2 md:gap-5 max-w-2xl mx-auto lg:mx-0">
                <div className="relative flex-[2] md:flex-1">
                  <div className="absolute inset-y-0 left-3 md:left-6 flex items-center pointer-events-none">
                    <FiSearch className="w-4 h-4 md:w-5 md:h-5 text-white" />
                  </div>
                  <input
                    type="text"
                    placeholder="Paste any SUI wallet here to analyze it"
                    className="w-full bg-[#111115] border border-white/10 rounded-full py-2.5 md:py-3 pl-10 md:pl-15 pr-8 md:pr-12 text-white placeholder:text-white/30 focus:outline-none focus:border-[#326AFD]/40 transition-all text-[10px] md:text-xs"
                  />
                  <div className="absolute right-3 md:right-5 top-1/2 -translate-y-1/2">
                    <button className="text-white/30 hover:text-white transition-colors flex items-center">
                      <IoClose className="w-3 h-3 md:w-5 md:h-5" />
                    </button>
                  </div>
                </div>
                <button className="bg-[#326AFD] hover:bg-[#2855D1] text-white px-3 md:px-4 py-2.5 md:py-3 rounded-4xl text-[10px] md:text-xs font-medium transition-all whitespace-nowrap shadow-lg shadow-[#326AFD]/10">
                  Analyze wallet
                </button>
              </div>
            </div>

            <div className="lg:w-1/2 relative portfolio-reveal-right">
              <div className="relative z-10 flex justify-center">
                <img
                  src="/assets/images/v2/port_mockup.png"
                  alt="Portfolio Dashboard"
                  className="w-full md:w-full h-auto scale-100 lg:scale-110 translate-x-0 lg:translate-x-4"
                />
              </div>
            </div>
          </div>
        </div>
      </section>


      {/* Alert Section */}
      <section className="alert-section relative bg-[#010103] overflow-hidden pt-8 pb-12 md:py-16">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex flex-col-reverse lg:flex-row items-center gap-12 lg:gap-20">

            <div className="lg:w-1/2 relative alert-reveal-left">
              <div className="relative z-10 flex justify-center">
                <img
                  src="/assets/images/v2/alert_mockup.png"
                  alt="Alert Dashboard"
                  className="w-full md:w-full h-auto scale-100 lg:scale-110 translate-x-0 lg:translate-x-4"
                />
              </div>
            </div>
            <div className="lg:w-1/2 alert-reveal-right text-center lg:text-right">
              <h3 className="text-2xl md:text-4xl font-medium mb-4 md:mb-6 text-white text-center lg:text-right">
                Alert <span className="text-[#B7FC0D]">Manager</span>
              </h3>
              <p className="text-white text-xs sm:text-sm md:text-md mb-8 md:mb-20 max-w-md leading-relaxed text-center lg:text-right mx-auto lg:ml-auto">
                Track wallet activity from subscribed addresses
              </p>

              <div className="flex flex-row items-center justify-center lg:justify-end gap-2 md:gap-5 max-w-2xl mx-auto lg:ml-auto">
                <div className="relative flex-[2] md:flex-1 max-w-[70%] lg:max-w-none">
                  <div className="absolute inset-y-0 left-3 md:left-6 flex items-center pointer-events-none">
                    <FiSearch className="w-4 h-4 md:w-5 md:h-5 text-white" />
                  </div>
                  <input
                    type="text"
                    placeholder="Paste any SUI wallet here to monitor it’s activity"
                    className="w-full bg-[#111115] border border-white/10 rounded-full py-2.5 md:py-3 pl-10 md:pl-15 pr-8 md:pr-12 text-white placeholder:text-white/30 focus:outline-none focus:border-[#326AFD]/40 transition-all text-[10px] md:text-xs"
                  />
                  <div className="absolute right-3 md:right-5 top-1/2 -translate-y-1/2">
                    <button className="text-white/30 hover:text-white transition-colors flex items-center">
                      <IoClose className="w-3 h-3 md:w-5 md:h-5" />
                    </button>
                  </div>
                </div>
                <button className="bg-[#326AFD] hover:bg-[#2855D1] text-white px-3 md:px-4 py-2.5 md:py-3 rounded-4xl text-[10px] md:text-xs font-medium transition-all whitespace-nowrap shadow-lg shadow-[#326AFD]/10">
                  Subscribe to Alerts
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

              
      {/* Task Section */}
       <section className="task-section relative bg-[#010103] overflow-hidden pt-8 pb-8 md:pt-16 md:pb-16">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex flex-col lg:flex-row items-center gap-12 lg:gap-20">
            <div className="lg:w-1/2 task-reveal-left text-center lg:text-left">
              <h3 className="text-2xl md:text-4xl font-medium mb-4 md:mb-6 text-white">
                Task <span className="text-[#B7FC0D]">Manager</span>
              </h3>
              <p className="text-white text-xs sm:text-sm md:text-md mb-8 md:mb-20 max-w-md mx-auto lg:mx-0 leading-relaxed">
                Manage personal tasks and reminders created through the task agent
              </p>

              <div className="relative max-w-md mx-auto lg:mx-0">
                <input
                  type="text"
                  placeholder="Remind me to check Tovira’s X page"
                  className="w-full bg-[#00060A] border-2 border-white/30 rounded-full py-3 md:py-4 pl-4 pr-12 md:pr-14 text-white placeholder:text-white/60 focus:outline-none focus:border-[#326AFD]/40 transition-all text-[10px] md:text-sm"
                />
                <div className="absolute right-2 top-1/2 -translate-y-1/2">
                  <button className="w-8 h-8 md:w-10 md:h-10 bg-[#326AFD] hover:bg-[#2855D1] text-white rounded-full flex items-center justify-center transition-all shadow-lg shadow-[#326AFD]/20">
                    <FiArrowUp className="w-4 h-4 md:w-5 md:h-5" />
                  </button>
                </div>
              </div>
            </div>

            <div className="lg:w-1/2 relative task-reveal-right">
              {/* Task Mascot peeking from behind */}
              <img
                src="/assets/images/v2/task.png"
                alt="Task Mascot"
                className="absolute top-14 -left-10 md:-left-28 w-40 md:w-80 h-auto z-0 pointer-events-none select-none opacity-40 hidden md:block"
              />
              <div className="relative z-10 flex justify-center">
                <img
                  src="/assets/images/v2/task_mockup.png"
                  alt="Task Manager Dashboard"
                  className="w-full md:w-full h-auto scale-100 lg:scale-110 translate-x-0 lg:translate-x-4"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Notifications Section */}
      <section className="notif-section relative bg-[#010103] pt-6 pb-32 md:py-32 overflow-hidden">
        <div className="max-w-7xl mx-auto px-6">
          <h2 className="text-xl md:text-5xl font-medium mb-20 text-center tracking-tight text-white leading-tight notif-reveal-up">
            Stay <span className="text-[#326AFD]">ahead</span> of the curve. Get notified when it <span className="text-[#B7FC0D]">matters</span>
          </h2>

          <div className="flex flex-col lg:flex-row items-center gap-20">
            {/* Left Column: Descriptive Text */}
            <div className="lg:w-1/2 space-y-4 notif-reveal-left text-center lg:text-left">
              <p className="text-white text-xl md:text-3xl font-light leading-snug">
                Receive wallet alerts and task reminders on Telegram, or Email
              </p>
              <p className="text-white text-xl md:text-3xl font-light leading-snug">
                Based on <span className="text-[#B7FC0D]">your preferences.</span>
              </p>
            </div>

            {/* Right Column: Image Placeholder */}
            <div className="lg:w-1/2 relative notif-reveal-right">
              <div className="relative z-10 flex justify-center">
                <img
                  src="/assets/images/v2/group_img.png"
                  alt="Notification Placeholder"
                  className="w-full max-w-lg h-auto"
                />
              </div>
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[130%] h-[130%] bg-[#326AFD]/5 blur-[120px] rounded-full z-0" />
            </div>
          </div>
        </div>
      </section>

      {/* Start Section */}
      <section className="start-section relative bg-[#010103] py-24 md:py-40 overflow-hidden">
        {/* Mascots flanking the section */}
        <div className="absolute -left-10 md:-left-20 top-16 md:top-10 w-20 md:w-56 opacity-90 pointer-events-none z-0 block start-reveal-mascot">
          <img src="/assets/images/v2/eva.png" alt="Eva Mascot" className="w-full h-auto" />
        </div>
        <div className="absolute -right-6 md:-right-10 bottom-16 md:bottom-10 w-20 md:w-56 opacity-90 pointer-events-none z-0 block start-reveal-mascot">
          <img src="/assets/images/v2/task.png" alt="Task Mascot" className="w-full h-auto" />
        </div>

        <div className="max-w-7xl mx-auto px-6 text-center relative z-10 start-reveal-up">
          <h2 className="text-3xl md:text-5xl lg:text-6xl font-medium mb-10 md:mb-16 tracking-tight text-white leading-tight">
            Start in <span className="text-[#326AFD]">under a minute</span>
          </h2>

          <div className="flex flex-row items-center justify-center gap-2 md:gap-4 mb-10 md:mb-16">
            <button className="flex items-center gap-1.5 md:gap-2 bg-[#0A0A0B] border border-white/10 px-3 md:px-6 py-2.5 md:py-3 rounded-full text-white text-[12px] sm:text-xs font-medium hover:bg-white/5 transition-all shadow-xl hover:shadow-white/5 whitespace-nowrap">
              <FcGoogle className="w-4 h-4 md:w-6 md:h-6 shrink-0" />
              Sign up with Google
            </button>
            <span className="text-white text-[14px] md:text-sm font-medium">or</span>
            <button className="flex items-center gap-1.5 md:gap-2 bg-[#0A0A0B] border border-white/10 px-3 md:px-6 py-2.5 md:py-3 rounded-full text-white text-[12px] sm:text-xs font-medium hover:bg-white/5 transition-all shadow-xl hover:shadow-[#326AFD]/5 whitespace-nowrap">
              <SiSui className="w-4 h-4 md:w-6 md:h-6 text-[#326AFD] shrink-0" />
              Continue with Sui
            </button>
          </div>

          <p className="text-white/80 text-sm md:text-xl font-medium">No complex setups</p>
        </div>
      </section>
      {/* Scroll to Top Button */}
      <AnimatePresence>
        {showScrollTop && (
          <motion.button
            initial={{ opacity: 0, scale: 0.5, y: 50 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.5, y: 50 }}
            transition={{ 
              type: "spring", 
              stiffness: 400, 
              damping: 25,
              mass: 1
            }}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="fixed bottom-10 right-10 z-50 bg-[#326AFD] text-white p-4 rounded-full shadow-2xl hover:bg-[#407BFF] cursor-pointer flex items-center justify-center"
            aria-label="Scroll to top"
          >
            <FiArrowUp className="w-6 h-6" />
          </motion.button>
        )}
      </AnimatePresence>

      <div className="md:hidden h-32"></div>
    </div>
  );
};

export default Home;