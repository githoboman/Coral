import React, { useState } from 'react';

interface Feature {
  id: number;
  title: string;
  description: string;
  icon: string;
}

const features = [
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
  }
]

const howItWorks = [
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
  }
]

const faqData = [
  {
    category: 'General',
    questions: [
      {
        question: 'What is Tovira?',
        answer: 'Tovira is an AI-powered crypto companion built on the Sui blockchain, designed to provide real-time insights, sentiment analysis, token and NFT research, and smart notifications to help users navigate the crypto market efficiently.'
      },
      {
        question: 'Who is Tovira for?',
        answer: 'Tovira is for traders, investors, and enthusiasts at all levels, from beginners to experienced degens, looking to gain actionable insights and stay ahead in the fast-paced crypto world.'
      }
    ]
  },
  {
    category: 'Features and Use Cases',
    questions: [
      {
        question: 'What can I do with Tovira?',
        answer: 'With Tovira, you can research tokens and NFTs, analyze market sentiment in real time, receive smart notifications for wallet movements and price actions, and leverage an AI that learns from your behavior to provide tailored insights.'
      },
      {
        question: 'What platforms does Tovira support?',
        answer: 'Tovira is accessible via a web app, mobile app, and integrates with platforms like Telegram and Discord for notifications and updates.'
      },
      {
        question: 'How is Tovira different from other tools?',
        answer: 'Tovira stands out by combining AI-driven insights with real-time data and a learning algorithm that adapts to user behavior, offering a personalized experience unlike static dashboards or generic analytics tools.'
      }
    ]
  },
  {
    category: 'Blockchain & AI',
    questions: [
      {
        question: 'Why use Sui blockchain?',
        answer: 'Tovira leverages the Sui blockchain for its high-speed transactions, low costs, and scalability, ensuring real-time insights and efficient processing for crypto-related activities.'
      },
      {
        question: 'Can I create a wallet with Tovira?',
        answer: 'Tovira does not directly create wallets but integrates seamlessly with existing Sui-compatible wallets, allowing you to monitor and manage your assets effectively.'
      }
    ]
  },
  {
    category: 'Rewards & Referrals',
    questions: [
      {
        question: 'Does Tovira have a rewards system?',
        answer: 'Yes, Tovira offers a rewards program for early adopters and active users, providing exclusive benefits and access to premium features. Join the waitlist to learn more.'
      },
      {
        question: 'How does the referral system work?',
        answer: 'Tovira’s referral system allows users to invite others and earn rewards, such as extended access or additional features. Specific details will be shared with waitlist members upon launch.'
      }
    ]
  }
]

const AccordionItem = ({ question, answer, isOpen, toggle }) => {
  return (
    <div className="border-b border-white/10">
      <button
        className="w-full text-left py-4 px-6 flex justify-between items-center hover:bg-white/5 transition-all"
        onClick={toggle}
      >
        <h4 className="text-xl font-semibold text-[#EDFFDE]">{question}</h4>
        <svg
          className={`w-6 h-6 text-[#6BD9F4] transform transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {isOpen && (
        <div className="px-6 pb-4">
          <p className="text-white/70">{answer}</p>
        </div>
      )}
    </div>
  );
};

const Home = () => {
  const [openItems, setOpenItems] = useState({});

  const toggleItem = (category, index) => {
    setOpenItems(prev => ({
      ...prev,
      [`${category}-${index}`]: !prev[`${category}-${index}`]
    }));
  };

  return (
    <div className="min-h-screen overflow-hidden bg-[#010103]">
      {/* Hero Section */}
      <section className="relative min-h-screen h-full md:py-20 md:pt-[4rem] mb-[8rem] md:bg-[url('/assets/images/hero-bg.png')] bg-no-repeat bg-cover bg-center bg-[#010103] flex items-center text-center">
        <div className="space-y-10">
          <div className="flex flex-col lg:flex-row flex-col-reverse items-center justify-between gap-12 md:gap-0 w-screen overflow-hidden">
            {/* Hero Content */}
            <div className="px-4 sm:px-6 lg:px-8 flex-1 max-w-2xl lg:max-w-4xl text-left">
              <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold mb-4 leading-tight">
                Your AI-Powered Crypto Companion
              </h1>
              <p className="text-base sm:text-lg md:text-xl text-white/80 mb-8 leading-relaxed">
                NOT JUST ANOTHER DASHBOARD, TOVIRA LISTENS, LEARNS, AND DELIVERS INSIGHTS THAT MATTER, FROM SENTIMENT ANALYSIS TO TOKEN RSEARCH, RIGHT INSIDE YOUR POCKET
              </p>

              {/* Hero CTA */}
              <div className="flex flex-col sm:flex-row gap-4">
                <a
                  href="#waitlist"
                  className="inline-block bg-white text-black font-bold py-3 px-6 rounded-xl text-center text-sm sm:text-base hover:from-[#79e8f0] hover:to-[#0687c2] transition-all duration-200 shadow-lg hover:shadow-xl"
                >
                  Join Waitlist
                </a>
                <a
                  href="https://x.com/tovira_sui"
                  className="inline-block bg-gradient-to-r from-[#159EF3] to-[#0D68A0] text-white font-bold py-3 px-6 rounded-xl text-center text-sm sm:text-base hover:from-[#79e8f0] hover:to-[#0687c2] transition-all duration-200 shadow-lg hover:shadow-xl"
                >
                  Follow on X
                </a>
              </div>
            </div>

            {/* Hero Image Placeholder */}
            <div className="relative flex-1 w-screen h-full flex justify-center">
              <div className="w-full h-full bg-gradient-to-br from-white/10 to-white/5 rounded-2xl backdrop-blur-sm">
                <img
                  src="/assets/images/hero-bg2.png"
                  alt="Hero Illustration"
                  className="w-full h-full object-contain rounded-2xl"
                />
              </div>

              {/* Subtle fadeout blend effect */}
              <div className="absolute bottom-0 h-[4rem] w-full bg-gradient-to-b from-transparent to-[#010103] rounded-2xl pointer-events-none"></div>
            </div>
          </div>

          {/* Features Row - Responsive Grid */}
          <div
            id="features"
            className="w-full max-w-6xl mx-auto static md:absolute -bottom-32 mt-[6rem] bg-gradient-to-b from-transparent to-[#010103] backdrop-blur-md left-0 right-0 flex flex-col items-start gap-2 px-4"
          >
            <h2 className="font-black text-[32px]">
              Tovira's Features
            </h2>
            <div className="flex flex-col md:flex-row gap-4 sm:gap-6 justify-center items-center">
              {features.map((feature) => (
                <div
                  key={feature.id}
                  className="bg-white/5 backdrop-blur-md rounded-xl border border-white/10 p-4 sm:p-6 w-full min-h-[15rem] flex flex-col justify-center text-center hover:bg-white/10 transition-all duration-200 hover:scale-105 hover:-translate-y-1 group"
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
                  <p className="text-xs sm:text-sm text-white/70 leading-relaxed">
                    {feature.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* About Us Section */}
      <section id="about" className="flex flex-col md:flex-row w-full relative py-20 bg-[#010103] text-white">
        <div className="w-full">
          <img
            src="/assets/images/about-img.png"
            alt="about section"
            className="w-full h-full object-cover"
          />
        </div>
        <div className="w-full px-6 space-y-10">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold bg-gradient-to-r from-white via-white to-[#8EF1FE] bg-clip-text text-transparent">
            <span className='bg-gradient-to-r from-[#326AFD] to-[#29D954] bg-clip-text text-transparent'>About</span> Tovira
          </h2>
          <p className="text-white/70 text-lg sm:text-xl leading-relaxed max-w-3xl mx-auto">
            Tovira is built to cut through the noise of crypto. Whether you’re chasing a token,
            researching a project, or just trying to understand market sentiment, we make it simple:
          </p>

          {/* Feature Points */}
          <div className="grid gap-8 sm:grid-cols-2 text-left">
            <div className="bg-white/5 backdrop-blur-md rounded-2xl border border-white/10 p-6 hover:bg-white/10 transition-all">
              <div className="flex gap-2 items-center mb-3">
                <img
                  src="/assets/icons/tick.svg"
                  alt="tick"
                  className="w-8 h-8"
                />
                <h3 className="text-xl font-semibold bg-gradient-to-r from-[#2E9BB2] to-[#2DAE94] bg-clip-text text-transparent">Ask Anything, Get Answers</h3>
              </div>
              <p className="text-white/60">
                Query tokens, NFTs, DeFi opportunities, or sentiment in plain language.
              </p>
            </div>
            <div className="bg-white/5 backdrop-blur-md rounded-2xl border border-white/10 p-6 hover:bg-white/10 transition-all">
              <div className="flex gap-2 items-center mb-3">
                <img
                  src="/assets/icons/tick.svg"
                  alt="tick"
                  className="w-8 h-8"
                />
                <h3 className="text-xl font-semibold bg-gradient-to-r from-[#2E9BB2] to-[#2DAE94] bg-clip-text text-transparent">Real-Time Sentiment Analysis</h3>
              </div>
              <p className="text-white/60">
                Learn what the market feels — not just what it looks like.
              </p>
            </div>
            <div className="bg-white/5 backdrop-blur-md rounded-2xl border border-white/10 p-6 hover:bg-white/10 transition-all">
              <div className="flex gap-2 items-center mb-3">
                <img
                  src="/assets/icons/tick.svg"
                  alt="tick"
                  className="w-8 h-8"
                />
                <h3 className="text-xl font-semibold bg-gradient-to-r from-[#2E9BB2] to-[#2DAE94] bg-clip-text text-transparent">AI-Powered Research</h3>
              </div>
              <p className="text-white/60">
                Distilled insights from trader behavior and Web3 trends.
              </p>
            </div>
          </div>

          {/* Notifications & Learning */}
          <div className="relative overflow-hidden bg-gradient-to-r from-[#060F19]/50 to-[#011020]/50 border-1 border-[#716868]/20 rounded-[15px] p-3 max-w-4xl mx-auto text-[#DDF3DD] text-base sm:text-lg leading-relaxed space-y-6 mt-10">
            <p>
              Our notifications are designed for real life, not overload. Users stay informed with
              clean email alerts, Telegram, and in-app signals that keep you ahead of wallet moves and
              alpha drops.
            </p>
            <p>
              What makes Tovira different is that it learns. The more it listens to the market —
              and to you — the sharper its responses become. This isn’t just about charts and numbers;
              it’s about building an AI companion that grows with the trader, degen, or newcomer who
              uses it.
            </p>

            <div className="absolute blur-sm -bottom-18 -right-18 w-[220.37px] h-[243.4px]">
              <img
                src="/assets/images/about-img2.png"
                alt="about"
                className="w-full h-full object-cover"
              />
            </div>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section id="support" className="relative py-20 bg-gradient-to-b from-[#010103] to-[#020206] px-6 sm:px-12 lg:px-20">
        <div className="relative max-w-xl mx-auto text-center space-y-12">
          <div className="absolute -top-25 -right-[65%] w-full">
            <img
              src="/assets/images/support-img.png"
              alt="about"
              className="w-full h-full object-cover"
            />
          </div>

          <div className="absolute -bottom-15 -left-[30%] w-1/2">
            <img
              src="/assets/images/support-img2.png"
              alt="about"
              className="w-full h-full object-cover"
            />
          </div>

          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white">
            How It Works
          </h2>
          {/* Steps Grid */}
          <div className="grid gap-10 sm:grid-cols-1 mt-10 z-[100]">
            {howItWorks.map((step) => (
              <div
                key={step.id}
                className="bg-[#061B53]/10 border-[2px] border-[#16A5FF]/20 rounded-2xl p-8 flex flex-col items-center text-center hover:bg-[#061B53]/15 backdrop-blur-sm transition-all"
              >
                <h3 className="text-xl font-semibold mb-3">{step.title}</h3>
                <p className="text-white/60">{step.description}</p>
              </div>
            ))}
          </div>

          {/* Closing Line */}
          <p className="z-[100] text-white/80 font-bold text-lg sm:text-xl mt-12 max-w-3xl mx-auto">
            <span className='bg-gradient-to-r from-[#326AFD] to-[#1E3F97] bg-clip-text text-transparent'>Tovira</span> isn’t just another tool. It’s your compass in the <span className='bg-gradient-to-r from-[#326AFD]/80 via-[#92EC47] to-[#92EC47] bg-clip-text text-[#92EC47]/50'>chaos of crypto.</span>
          </p>
        </div>
      </section>

      {/* Waitlist Section */}
      <section className="h-[50rem] md:h-[120rem] bg-[#010103] flex flex-col justify-center relative overflow-hidden">
        <div className="h-[150rem] flex flex-col justify-center relative overflow-hidden">
          <img
            src="/assets/images/waitlist.png"
            alt="waitlist"
            className="w-full h-full object-cover"
          />
        </div>

        {/* Tovira Logo background */}
        <div className="absolute inset-0 flex items-end md:items-center justify-center">
          <img
            src="/assets/images/tovira-bg.png"
            alt="Tovira Logo"
            className="mb-[18rem] md:mb-[22rem] w-64 h-64 sm:w-96 sm:h-96 object-contain"
          />
        </div>

        <div id="waitlist" className="absolute inset-0 px-4 h-full flex justify-center items-end md:items-center z-10">
          <div className="max-w-3xl mx-auto text-center">
            {/* Waitlist Card */}
            <div className="bg-white/5 backdrop-blur-xl rounded-3xl border border-white/10 p-6 sm:p-8 lg:p-12">
              <div className="mb-8">
                <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold mb-4 bg-gradient-to-r from-white via-white to-[#8EF1FE] bg-clip-text text-transparent">
                  Join the Waitlist
                </h2>
                <p className="text-white/60 text-sm sm:text-base max-w-2xl mx-auto leading-relaxed">
                  Be the first to experience Tovira's revolutionary wallet intelligence platform.
                  Get early access and exclusive features.
                </p>
              </div>

              {/* Waitlist Form */}
              <form className="w-full max-w-md mx-auto" onSubmit={(e) => e.preventDefault()}>
                <div className="space-y-4">
                  <div>
                    <input
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-2xl text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-[#8EF1FE]/30 focus:border-transparent transition-all duration-200 text-sm sm:text-base"
                      type="email"
                      placeholder="Enter your email address"
                      aria-label="Email address for waitlist"
                      required
                    />
                  </div>
                  <button
                    className="w-full bg-gradient-to-r from-[#8EF1FE] to-[#0796D9] text-black font-bold py-3 px-6 rounded-2xl text-sm sm:text-base hover:from-[#79e8f0] hover:to-[#0687c2] transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
                    type="submit"
                  >
                    <span className="flex items-center justify-center gap-2">
                      Join Waitlist
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                      </svg>
                    </span>
                  </button>
                </div>

                {/* Trust indicators */}
                <div className="mt-8 pt-6 border-t border-white/10">
                  <p className="text-white/40 text-xs sm:text-sm text-center">
                    Join 15K+ others on the waitlist
                  </p>
                  <div className="flex justify-center items-center gap-4 mt-3 flex-wrap">
                    <div className="w-8 h-8 bg-white/10 rounded-full"></div>
                    <div className="w-6 h-6 bg-white/10 rounded-full"></div>
                    <div className="w-8 h-8 bg-white/10 rounded-full"></div>
                    <div className="w-7 h-7 bg-white/10 rounded-full"></div>
                  </div>
                </div>
              </form>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section id="faq" className="py-20 bg-[#010103] text-white px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold mb-12 text-center bg-gradient-to-r from-white via-white to-[#8EF1FE] bg-clip-text text-transparent">
            FAQ
          </h2>
          
          {faqData.map((category, catIndex) => (
            <div key={catIndex} className="mb-12">
              <h3 className="text-2xl font-bold mb-6">
                {category.category}
              </h3>
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
            </div>
          ))}
        </div>
      </section>

      {/* Spacer to prevent footer overlap */}
      <div className="md:hidden h-32"></div>
    </div>
  )
}

export default Home