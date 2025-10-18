import React, { useState, useEffect } from 'react';
import { motion, Variants } from 'framer-motion';
import { toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

interface Feature {
  id: number;
  title: string;
  description: string;
  icon: string;
}

interface HowItWorks {
  id: number;
  title: string;
  description: string;
  icon: string;
}

interface FAQQuestion {
  question: string;
  answer: string;
}

interface FAQCategory {
  category: string;
  questions: FAQQuestion[];
}

const features: Feature[] = [
  {
    id: 1,
    title: 'Token & NFT Research',
    description: 'Comprehensive, AI-filtered insights.',
    icon: '/assets/icons/f1.svg',
  },
  {
    id: 2,
    title: 'Sentiment Analysis',
    description: 'Understand the market emotions in real time.',
    icon: '/assets/icons/f2.svg',
  },
  {
    id: 3,
    title: 'Smart Notifications',
    description: 'Never miss a wallet move, NFT drop, Price action or future appointment.',
    icon: '/assets/icons/f3.svg',
  },
  {
    id: 4,
    title: 'AI Learning Loop',
    description: 'Learns from trader behaviour to give sharper responses over time.',
    icon: '/assets/icons/f4.svg',
  },
];

const howItWorks: HowItWorks[] = [
  {
    id: 1,
    title: 'Ask',
    description: 'Text Tovira about a token, trend, or project.',
    icon: '/assets/icons/ask.svg',
  },
  {
    id: 2,
    title: 'Learn',
    description: 'Get AI-powered insights, research, and sentiment in seconds.',
    icon: '/assets/icons/learn.svg',
  },
  {
    id: 3,
    title: 'Act',
    description: 'Use signals + alerts to trade smarter — no more guesswork.',
    icon: '/assets/icons/act.svg',
  },
];

const faqData: FAQCategory[] = [
  {
    category: 'General',
    questions: [
      {
        question: 'What is Tovira?',
        answer: 'Tovira is an AI-powered Web3 companion that helps you track wallets, Tokens and NFTs, monitor sentiment, set reminders, and receive personalized notifications. Built on the Sui blockchain, it combines AI research with real-time on-chain data in one seamless tool.',
      },
      {
        question: 'Who is Tovira for?',
        answer: 'Tovira is designed for traders, degen farmers, NFT collectors, and crypto newcomers who want clarity in a noisy market.',
      },
    ],
  },
  {
    category: 'Features & Use Cases',
    questions: [
      {
        question: 'What can I do with Tovira?',
        answer: 'With Tovira you can: - Track Sui wallets in real-time. - Monitor NFT Floor prices. - Perform sentiment lookups. - Set reminders & schedules. - Receive notifications via Telegram, Email - Manage your profile and subscriptions easily.',
      },
      {
        question: 'What platforms does Tovira support?',
        answer: 'Tovira is available as a Telegram bot (with Web App integration), a browser extension (post-MVP), and a dashboard-style web app.',
      },
      {
        question: 'How is Tovira different from other tools?',
        answer: 'Unlike platforms that only give analytics, Tovira merges AI-powered insights, wallet tracking, sentiment analysis, and multi-channel notifications into one assistant.',
      },
    ],
  },
  {
    category: 'Blockchain & AI',
    questions: [
      {
        question: 'Why use Sui blockchain?',
        answer: 'Sui provides low-cost, fast transactions. Tovira uses it for wallet creation, subscriptions, and gas-related operations.',
      },
      {
        question: 'Can I create a wallet with Tovira?',
        answer: 'Yes. You can import an existing wallet or create a new one using biometrics during onboarding.',
      },
    ],
  },
  {
    category: 'Rewards & Referrals',
    questions: [
      {
        question: 'Does Tovira have a rewards system?',
        answer: 'Yes. You can earn points by completing on-chain tasks, referring active friends, and staying consistent with usage.',
      },
      {
        question: 'How does the referral system work?',
        answer: 'You get points when someone joins via your link and completes basic on-chain tasks. Points earned are accumulated for rewards at a later time.',
      },
    ],
  },
];


interface AccordionItemProps {
  question: string;
  answer: string;
  isOpen: boolean;
  toggle: () => void;
}

const AccordionItem: React.FC<AccordionItemProps> = ({ question, answer, isOpen, toggle }) => {
  return (
    <div className="border-b border-white/10">
      <button
        className="w-full text-left py-4 px-6 flex justify-between items-center hover:bg-white/5 transition-all"
        onClick={toggle}
        type="button"
      >
        <h4 className="text-md font-semibold text-[#EDFFDE]">{question}</h4>
        <svg
          className={`w-6 h-6 text-[#6BD9F4] transform transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <motion.div
        initial={false}
        animate={{ height: isOpen ? 'auto' : 0, opacity: isOpen ? 1 : 0 }}
        transition={{ duration: 0.3, ease: 'easeInOut' }}
        style={{ overflow: 'hidden' }}
      >
        <div className="px-6 pb-4">
          <p className="text-white/70">{answer}</p>
        </div>
      </motion.div>
    </div>
  );
};

const Home: React.FC = () => {
  const [openItems, setOpenItems] = useState<Record<string, boolean>>({});
  const [email, setEmail] = useState<string>('');
  const [isSubscribed, setIsSubscribed] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  useEffect(() => {
    if (localStorage.getItem('tovira_waitlist_subscribed') === 'true') {
      setIsSubscribed(true);
    }
  }, []);

  const toggleItem = (category: string, index: number): void => {
    setOpenItems((prev) => ({
      ...prev,
      [`${category}-${index}`]: !prev[`${category}-${index}`],
    }));
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!email) return;
    setIsLoading(true);
    try {
      const response = await fetch('https://tovira-server.onrender.com/waitlist', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email }),
      });
      if (response.ok) {
        const data = await response.json();
        toast.success(data.message);
        setEmail('');
        setIsSubscribed(true);
        localStorage.setItem('tovira_waitlist_subscribed', 'true');
      } else {
        const errorData = await response.json();
        toast.error(errorData.detail || 'Failed to join waitlist');
      }
    } catch (error) {
      toast.error('An error occurred. Please try again later.');
    } finally {
      setIsLoading(false);
    }
  };

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
        ease: 'easeOut',
      },
    },
  };

  return (
    <div className="min-h-screen overflow-hidden bg-[#010103]">
      <section className="relative md:min-h-[45rem] h-full mb-[8rem] md:bg-[url('/assets/images/hero-bg.png')] bg-no-repeat bg-cover bg-center bg-[#010103] flex items-center text-center">
        <div className="space-y-10 ">
          <motion.div
            className="flex flex-col md:flex-row flex-col-reverse items-center justify-between gap-12 md:gap-0 w-screen overflow-hidden"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={containerVariants}
          >
            <motion.div
              className="px-4 sm:px-6 lg:px-8 flex-1 max-w-2xl lg:max-w-4xl text-left"
              variants={itemVariants}
            >
              <motion.h1
                className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold mb-4 leading-tight"
                variants={itemVariants}
              >
                Your AI-Powered Crypto Companion
              </motion.h1>
              <motion.p
                className="text-base sm:text-lg md:text-xl text-white/80 mb-8 leading-relaxed"
                variants={itemVariants}
              >
                NOT JUST ANOTHER DASHBOARD, TOVIRA LISTENS, LEARNS, AND DELIVERS INSIGHTS THAT MATTER,
                FROM SENTIMENT ANALYSIS TO TOKEN RESEARCH, RIGHT INSIDE YOUR POCKET
              </motion.p>
              <motion.div className="flex flex-col sm:flex-row gap-4" variants={itemVariants}>
                <a
                  href="#waitlist"
                  className="inline-block bg-white text-black font-bold py-3 px-6 rounded-xl text-center text-sm sm:text-base hover:bg-gradient-to-r hover:from-[#79e8f0] hover:to-[#0687c2] transition-all duration-200 shadow-lg hover:shadow-xl"
                >
                  Join Waitlist
                </a>
                <a
                  href="https://x.com/tovira_sui"
                  target="_blank"
                  className="inline-block bg-gradient-to-r from-[#159EF3] to-[#0D68A0] text-white font-bold py-3 px-6 rounded-xl text-center text-sm sm:text-base hover:from-[#79e8f0] hover:to-[#0687c2] transition-all duration-200 shadow-lg hover:shadow-xl"
                >
                  Follow on X
                </a>
              </motion.div>
            </motion.div>
            <motion.div
              className="relative flex-1 w-screen h-full flex justify-center"
              variants={itemVariants}
            >
              <div className="md:hidden w-full h-full bg-gradient-to-br from-white/10 to-white/5 rounded-2xl backdrop-blur-sm">
                <img
                  src="/assets/images/hero-bg2.png"
                  alt="Hero Illustration"
                  className="w-full h-full object-contain rounded-2xl"
                />
              </div>
              <div className="md:hidden absolute bottom-0 h-[4rem] w-full bg-gradient-to-b from-transparent to-[#010103] rounded-2xl pointer-events-none"></div>
            </motion.div>
          </motion.div>
          <div
            id="features"
            className="w-full max-w-6xl mx-auto static md:absolute -bottom-32 mt-[6rem] bg-gradient-to-b from-transparent to-[#010103] backdrop-blur-md left-0 right-0 flex flex-col items-start gap-2 px-4"
          >
            <h2 className="font-black text-[32px] mb-4">Tovira's Features</h2>

            <motion.div
              className="flex flex-col md:flex-row w-full gap-4 sm:gap-6 justify-center items-center"
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={containerVariants}
            >
              {features.map((feature) => (
                <motion.div
                  key={feature.id}
                  className="bg-white/5 backdrop-blur-md rounded-xl border border-white/10 p-4 sm:p-6 w-full min-h-[15rem] flex flex-col justify-center text-center hover:bg-white/10 transition-all duration-200 hover:scale-105 hover:-translate-y-1 group"
                  variants={itemVariants}
                >
                  <div className="flex justify-center mb-4">
                    <img
                      src={feature.icon}
                      alt={feature.title}
                      className="h-10 w-10 sm:h-12 sm:w-12 group-hover:scale-110 transition-transform duration-200"
                    />
                  </div>
                  <h3 className="text-lg sm:text-xl font-semibold mb-3 text-white group-hover:text-[#8EF1FE] transition-colors duration-200">
                    {feature.title}
                  </h3>
                  <p className="text-xs sm:text-sm text-white/70 leading-relaxed">{feature.description}</p>
                </motion.div>
              ))}
            </motion.div>
          </div>
        </div>
      </section>

      <section id="about" className="flex flex-col md:flex-row w-full relative md:mt-60 py-20 bg-[#010103] text-white">
        <motion.div
          className="w-full"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={itemVariants}
        >
          <img src="/assets/images/about-img.png" alt="About section" className="w-full h-full object-cover" />
        </motion.div>
        <motion.div
          className="w-full px-6 md:px-20 space-y-10"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={containerVariants}
        >
          <motion.h2
            className="text-3xl sm:text-4xl lg:text-5xl font-bold bg-gradient-to-r from-white via-white to-[#8EF1FE] bg-clip-text text-transparent"
            variants={itemVariants}
          >
            <span className="bg-gradient-to-r from-[#326AFD] to-[#29D954] bg-clip-text text-transparent">About</span> Tovira
          </motion.h2>
          <motion.p
            className="text-white/70 text-lg sm:text-xl leading-relaxed max-w-3xl mx-auto"
            variants={itemVariants}
          >
            Tovira is built to cut through the noise of crypto. Whether you’re chasing a token, researching a project, or
            just trying to understand market sentiment, we make it simple:
          </motion.p>
          <motion.div className="grid gap-8 sm:grid-cols-2 text-left" variants={containerVariants}>
            <motion.div
              className="bg-white/5 backdrop-blur-md rounded-2xl border border-white/10 p-6 hover:bg-white/10 transition-all"
              variants={itemVariants}
            >
              <div className="flex gap-2 items-center mb-3">
                <img src="/assets/icons/tick.svg" alt="Tick" className="w-8 h-8" />
                <h3 className="text-xl font-semibold bg-gradient-to-r from-[#2E9BB2] to-[#2DAE94] bg-clip-text text-transparent">
                  Ask Anything, Get Answers
                </h3>
              </div>
              <p className="text-white/60">Query tokens, NFTs, DeFi opportunities, or sentiment in plain language.</p>
            </motion.div>
            <motion.div
              className="bg-white/5 backdrop-blur-md rounded-2xl border border-white/10 p-6 hover:bg-white/10 transition-all"
              variants={itemVariants}
            >
              <div className="flex gap-2 items-center mb-3">
                <img src="/assets/icons/tick.svg" alt="Tick" className="w-8 h-8" />
                <h3 className="text-xl font-semibold bg-gradient-to-r from-[#2E9BB2] to-[#2DAE94] bg-clip-text text-transparent">
                  Real-Time Sentiment Analysis
                </h3>
              </div>
              <p className="text-white/60">Learn what the market feels — not just what it looks like.</p>
            </motion.div>
            <motion.div
              className="bg-white/5 backdrop-blur-md rounded-2xl border border-white/10 p-6 hover:bg-white/10 transition-all"
              variants={itemVariants}
            >
              <div className="flex gap-2 items-center mb-3">
                <img src="/assets/icons/tick.svg" alt="Tick" className="w-8 h-8" />
                <h3 className="text-xl font-semibold bg-gradient-to-r from-[#2E9BB2] to-[#2DAE94] bg-clip-text text-transparent">
                  AI-Powered Research
                </h3>
              </div>
              <p className="text-white/60">Distilled insights from trader behavior and Web3 trends.</p>
            </motion.div>
          </motion.div>
          <motion.div
            className="relative overflow-hidden bg-gradient-to-r from-[#060F19]/50 to-[#011020]/50 border-1 border-[#716868]/20 rounded-[15px] p-3 max-w-4xl mx-auto text-[#DDF3DD] text-base sm:text-lg leading-relaxed space-y-6 mt-10"
            variants={itemVariants}
          >
            <p>
              Our notifications are designed for real life, not overload. Users stay informed with clean email alerts,
              Telegram, and in-app signals that keep you ahead of wallet moves and alpha drops.
            </p>
            <p>
              What makes Tovira different is that it learns. The more it listens to the market — and to you — the sharper
              its responses become. This isn’t just about charts and numbers; it’s about building an AI companion that
              grows with the trader, degen, or newcomer who uses it.
            </p>
            <div className="absolute blur-sm -bottom-18 -right-18 w-[220.37px] h-[243.4px]">
              <img src="/assets/images/about-img2.png" alt="About" className="w-full h-full object-cover" />
            </div>
          </motion.div>
        </motion.div>
      </section>
      <section
        id="support"
        className="relative py-20 md:mt-40 bg-gradient-to-b from-[#010103] to-[#020206] px-6 sm:px-12 lg:px-20"
      >
        <motion.div
          className="relative max-w-xl mx-auto text-center space-y-12"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={containerVariants}
        >
          <div className="absolute -top-25 -right-[65%] w-full">
            <img src="/assets/images/support-img.png" alt="Support" className="w-full h-full object-cover" />
          </div>
          <div className="absolute -bottom-15 -left-[30%] w-1/2">
            <img src="/assets/images/support-img2.png" alt="Support" className="w-full h-full object-cover" />
          </div>
          <motion.h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white" variants={itemVariants}>
            How It Works
          </motion.h2>
          <motion.div className="grid gap-10 sm:grid-cols-1 mt-10 z-[100]" variants={containerVariants}>
            {howItWorks.map((step) => (
              <motion.div
                key={step.id}
                className="bg-[#061B53]/10 border-[2px] border-[#16A5FF]/20 rounded-2xl p-8 flex flex-col items-center text-center hover:bg-[#061B53]/15 backdrop-blur-sm transition-all"
                variants={itemVariants}
              >
                <h3 className="text-xl font-semibold mb-3">{step.title}</h3>
                <p className="text-white/60">{step.description}</p>
              </motion.div>
            ))}
          </motion.div>
          <motion.p
            className="z-[100] text-white/80 font-bold text-lg sm:text-xl mt-12 max-w-3xl mx-auto"
            variants={itemVariants}
          >
            <span className="bg-gradient-to-r from-[#326AFD] to-[#1E3F97] bg-clip-text text-transparent">Tovira</span>{' '}
            isn’t just another tool. It’s your compass in the{' '}
            <span className="bg-gradient-to-r from-[#326AFD]/80 via-[#92EC47] to-[#92EC47] bg-clip-text text-[#92EC47]/50">
              chaos of crypto.
            </span>
          </motion.p>
        </motion.div>
      </section>
      <section className="h-[50rem] md:h-[80rem] bg-[#010103] flex flex-col justify-center relative overflow-hidden">
        <div className="h-[100rem] flex flex-col justify-center relative overflow-hidden">
          <img src="/assets/images/waitlist.png" alt="Waitlist" className="w-full h-full object-cover" />
        </div>
        <div className="absolute inset-0 flex items-end md:items-center justify-center">
          <img
            src="/assets/images/tovira-bg.png"
            alt="Tovira Logo"
            className="mb-[18rem] md:mb-[22rem] w-64 h-64 sm:w-96 sm:h-96 object-contain"
          />
        </div>
        <div id="waitlist" className="absolute inset-0 px-4 h-full flex justify-center mt-20 md:mt-0 items-center z-10">
          <motion.div
            className="max-w-3xl mx-auto text-center"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={containerVariants}
          >
            <motion.div
              className="bg-white/5 backdrop-blur-xl rounded-3xl border border-white/10 p-6 sm:p-8 lg:p-12"
              variants={itemVariants}
            >
              <motion.div className="mb-8 flex flex-col gap-4 items-center" variants={itemVariants}>
                <div className="w-[100px] h-[93px] rounded-[30px] bg-gradient-to-br from-[#8EF1FE] to-[#0796D9] flex items-center justify-center -rotate-45">
                  <img
                    src="/assets/images/waitlist-success.png"
                    alt="waitlist-success"
                    className="object-cover rotate-45"
                  />
                </div>

                <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold mb-4 bg-gradient-to-r from-white via-white to-[#8EF1FE] bg-clip-text text-transparent">
                  Success
                </h2>
                <p className="text-white/60 text-sm sm:text-base max-w-2xl mx-auto leading-relaxed">
                  Wait-list concluded, watch out for an email from us....
                </p>
              </motion.div>
              <div className="w-full flex justify-end">
                <a href="https://x.com/tovira_sui" target="_blank">
                  <img
                    src="/assets/icons/x.svg"
                    alt="X"
                    className=""
                  />
                </a>
              </div>
            </motion.div>
          </motion.div>
        </div>
      </section>
      <section id="faq" className="py-20 bg-[#010103] text-white px-4 sm:px-6 lg:px-8">
        <motion.div
          className="max-w-2xl mx-auto"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={containerVariants}
        >
          <motion.h2
            className="text-3xl sm:text-4xl lg:text-5xl font-bold mb-12 text-center bg-gradient-to-r from-white via-white to-[#8EF1FE] bg-clip-text text-transparent"
            variants={itemVariants}
          >
            FAQ
          </motion.h2>
          {faqData.map((category, catIndex) => (
            <motion.div key={catIndex} className="mb-12" variants={itemVariants}>
              <h3 className="text-xl font-bold mb-6">{category.category}</h3>
              <div className="space-y-2">
                {category.questions.map((item, index) => (
                  <AccordionItem
                    key={index}
                    question={item.question}
                    answer={item.answer}
                    isOpen={openItems[`${category.category}-${index}`] || false}
                    toggle={() => toggleItem(category.category, index)}
                  />
                ))}
              </div>
            </motion.div>
          ))}
        </motion.div>
      </section>
      <div className="md:hidden h-32"></div>
    </div>
  );
};

export default Home;