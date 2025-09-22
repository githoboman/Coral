const features = [
  {
    id: 1,
    title: 'Track Any Wallet',
    description: 'Instantly view on-chain activity across multiple chains with AI-Powered wallet tracking',
    icon: '/assets/icons/f1.svg',
  },
  {
    id: 2,
    title: 'Track Any Wallet',
    description: 'Instantly view on-chain activity across multiple chains with AI-Powered wallet tracking',
    icon: '/assets/icons/f2.svg',
  },
  {
    id: 3,
    title: 'Track Any Wallet',
    description: 'Instantly view on-chain activity across multiple chains with AI-Powered wallet tracking',
    icon: '/assets/icons/f3.svg',
  },
]

const Home = () => {
  return (
    <div className="min-h-screen bg-[#010103]">
      {/* Hero Section */}
      <section className="relative min-h-screen h-full md:py-20 md:pt-[4rem] mb-[8rem] md:bg-[url('/assets/images/hero-bg.png')] bg-cover bg-center bg-[#010103] flex items-center text-center">
        <div className="container mx-auto space-y-10">
          <div className="flex flex-col lg:flex-row flex-col-reverse items-center justify-between gap-12">
            {/* Hero Content */}
            <div className="px-4 sm:px-6 lg:px-8 flex-1 max-w-2xl lg:max-w-4xl text-left">
              <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold mb-4 leading-tight">
                AI-Powered Sentiment & Wallet Intelligence
              </h1>
              <p className="text-base sm:text-lg md:text-xl text-white/80 mb-8 leading-relaxed">
                NEXT-GEN WALLET INTELLIGENCE; REAL-TIME PORTFOLIO TRACKING, SENTIMENT ANALYSIS, AND AI-POWERED ALERTS.
              </p>

              {/* Hero CTA */}
              <div className="flex flex-col sm:flex-row gap-4">
                <a
                  href="#waitlist"
                  className="inline-block bg-gradient-to-r from-[#8EF1FE] to-[#0796D9] text-black font-bold py-3 px-6 rounded-full text-center text-sm sm:text-base hover:from-[#79e8f0] hover:to-[#0687c2] transition-all duration-200 shadow-lg hover:shadow-xl"
                >
                  Join Waitlist
                </a>
                <a
                  href="#features"
                  className="hidden md:inline-flex items-center gap-2 text-white/80 hover:text-white transition-colors duration-200 font-medium"
                >
                  Learn More
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                  </svg>
                </a>
              </div>
            </div>

            {/* Hero Image Placeholder */}
            <div className="relative flex-1 w-full h-full flex justify-center">
              <div className="w-full h-full bg-gradient-to-br from-white/10 to-white/5 rounded-2xl backdrop-blur-sm">
                <img
                  src="/assets/images/hero-bg2.png"
                  alt="Hero Illustration"
                  className="w-full h-full object-contain rounded-2xl"
                />
              </div>

              {/* I'm adding a subtle fadeout blend effect here */}
              <div className="absolute bottom-0 h-[4rem] w-full bg-gradient-to-b from-transparent to-[#010103] rounded-2xl pointer-events-none"></div>
            </div>
          </div>

          {/* Features Row - Responsive Grid */}
          <div
            id="features"
            className="static md:absolute -bottom-32 mt-[6rem] bg-gradient-to-b from-transparent to-[#010103] backdrop-blur-md left-0 right-0 flex justify-center px-4"
          >
            <div className="flex flex-col sm:flex-row gap-4 sm:gap-6 justify-center items-center w-full max-w-6xl mx-auto">
              {features.map((feature) => (
                <div
                  key={feature.id}
                  className="bg-white/5 backdrop-blur-md rounded-xl border border-white/10 p-4 sm:p-6 w-full sm:w-64 text-center hover:bg-white/10 transition-all duration-200 hover:scale-105 hover:-translate-y-1 group"
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

      {/* Waitlist Section */}
      <section
        className="h-[50rem] md:h-[120rem] bg-[#010103] flex flex-col justify-center relative overflow-hidden"
      >
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

      {/* Spacer to prevent footer overlap */}
      <div className="h-32 lg:h-48"></div>
    </div>
  )
}

export default Home