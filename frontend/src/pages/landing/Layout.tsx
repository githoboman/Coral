import { Outlet, useLocation, Link } from 'react-router-dom';
import { useState } from 'react';

const LandingPageLayout = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const location = useLocation();

  // Set to false to show Coming Soon screen; change to true when ready to launch
  
  const navigationItems = [
    { name: 'Home', to: '/' },
    { name: 'About', to: '#about' },
    { name: 'Support', to: '#support' },
    { name: 'Contact Us', to: '/contact' },
  ];

  const companyLinks = [
    { name: 'About Us', to: '#about' },
    { name: 'Careers', to: '/careers' },
    { name: 'Press', to: '/press' },
    { name: 'Blog', to: '/blog' },
  ];


  return (
    <main className="bg-gradient-to-b from-[#010103] to-[#010102] text-white flex flex-col min-h-screen max-w-screen overflow-hidden">
      {/* HEADER */}
      <header className="fixed top-0 left-0 z-50 w-full border-b border-white/10 bg-[#010103]/70 backdrop-blur-sm">
        <div className="container mx-auto px-4 sm:px-6 lg:px-10">
          <div className="flex justify-between items-center py-4">
            {/* Logo */}
            <div className="flex items-center">
              <Link to="/" className="flex items-center hover:opacity-80 transition-opacity duration-200">
                <img
                  src="/assets/logo.png"
                  alt="Tovira Logo"
                  className="h-8 w-8 mr-2"
                />
                <h1 className="text-xl sm:text-2xl font-bold text-white">
                  Tovira
                </h1>
              </Link>
            </div>

            {/* Desktop Navigation */}
            <nav className="hidden md:flex items-center space-x-6">
              <ul className="flex items-center space-x-8">
                {navigationItems.map((item) => (
                  <li key={item.name}>
                    <a
                      href={item.to}
                      className={`text-sm font-medium transition-colors duration-200 hover:text-white/80 ${location.pathname === item.to
                        ? 'text-white'
                        : 'text-white/70'
                        }`}
                    >
                      {item.name}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>

            {/* Desktop CTA - White Button */}
            <div className="hidden md:flex items-center space-x-4">
              <a
                href="#waitlist"
                className="bg-white text-black font-semibold py-2 px-6 rounded-lg hover:bg-gray-100 transition-colors duration-200 text-sm shadow-lg hover:shadow-xl"
              >
                Join Waitlist
              </a>
            </div>

            {/* Mobile menu button */}
            <div className="md:hidden">
              <button
                onClick={() => setIsMenuOpen(!isMenuOpen)}
                className="p-2 rounded-md focus:outline-none focus:ring-2 focus:ring-white/20"
              >
                <span className="sr-only">Toggle menu</span>
                <svg
                  className="h-6 w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  {isMenuOpen ? (
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  ) : (
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 6h16M4 12h16M4 18h16"
                    />
                  )}
                </svg>
              </button>
            </div>
          </div>

          {/* Mobile Navigation Menu */}
          {isMenuOpen && (
            <div className="md:hidden pb-4 border-t border-white/10">
              <ul className="flex flex-col space-y-4 pt-4">
                {navigationItems.map((item) => (
                  <li key={item.name}>
                    <a
                      href={item.to}
                      className={`block py-2 px-3 text-base font-medium transition-colors duration-200 hover:bg-white/5 rounded-lg ${location.pathname === item.to
                        ? 'text-white'
                        : 'text-white/70'
                        }`}
                      onClick={() => setIsMenuOpen(false)}
                    >
                      {item.name}
                    </a>
                  </li>
                ))}
                <li className="pt-2">
                  <a
                    href="/#waitlist"
                    className="w-full bg-white text-black font-semibold py-3 px-4 rounded-lg hover:bg-gray-100 transition-colors duration-200 text-sm block text-center shadow-lg hover:shadow-xl"
                    onClick={() => setIsMenuOpen(false)}
                  >
                    Join Waitlist
                  </a>
                </li>
              </ul>
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1">
        <Outlet />
      </div>

      {/* FOOTER */}
      <footer className="border-t border-white/10 bg-gradient-to-t from-[#010103]/95 to-transparent backdrop-blur-sm">
        <div className="container mx-auto px-4 sm:px-6 lg:px-10">
          <div className="py-8 sm:py-12">
            {/* Main Footer Content */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8">
              {/* Brand & Description */}
              <div className="lg:col-span-1 space-y-4">
                <div className="flex items-center">
                  <Link to="/" className="flex items-center hover:opacity-80 transition-opacity duration-200">
                    <img
                      src="/assets/logo.png"
                      alt="Tovira Logo"
                      className="h-8 w-8 mr-2"
                    />
                    <h3 className="text-xl sm:text-2xl font-bold text-white">
                      Tovira
                    </h3>
                  </Link>
                </div>
                <p className="text-white/60 text-sm leading-relaxed max-w-sm">
                  Built on the Sui blockchain. Advanced wallet intelligence with AI-powered insights across multiple chains.
                </p>
                {/* Footer CTA - Green Button */}
                <div className="pt-2">
                  <a
                    href="#waitlist"
                    className="inline-flex items-center gap-2 bg-gradient-to-r from-[#00FF88] to-[#00CC6A] text-black font-semibold py-2 px-6 rounded-lg hover:from-[#00e679] hover:to-[#00b85a] transition-all duration-200 text-sm shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
                  >
                    <span>Join Waitlist</span>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                    </svg>
                  </a>
                </div>
              </div>

              <div className="flex items-start justify-between w-full">
                {/* Product Links */}
                <div>
                  <h4 className="text-sm font-semibold mb-4 uppercase tracking-wider text-white/70">
                    Product
                  </h4>
                  <ul className="space-y-2">
                    {navigationItems.map((item) => (
                      <li key={item.name}>
                        <a
                          href={item.to}
                          className="text-white/60 text-sm hover:text-white transition-colors duration-200 block hover:bg-white/5 px-2 py-1 rounded group"
                        >
                          <span className="group-hover:translate-x-1 transition-transform duration-200">
                            {item.name}
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Company Links */}
                <div>
                  <h4 className="text-sm font-semibold mb-4 uppercase tracking-wider text-white/70">
                    Company
                  </h4>
                  <ul className="space-y-2">
                    {companyLinks.slice(0, 3).map((item) => (
                      <li key={item.name}>
                        <Link
                          to={item.to}
                          className="text-white/60 text-sm hover:text-white transition-colors duration-200 block hover:bg-white/5 px-2 py-1 rounded group"
                        >
                          <span className="group-hover:translate-x-1 transition-transform duration-200">
                            {item.name}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Connect & Social */}
              <div className="space-y-4 flex flex-col items-start md:items-center">
                <div>
                  <h4 className="text-sm font-semibold mb-4 uppercase tracking-wider text-white/70">
                    Connect
                  </h4>
                  <div className="space-y-2">
                    <p className="text-white/60 text-sm">hello@tovira.xyz</p>
                    <p className="text-white/60 text-sm">Built on <span className="font-semibold text-[#00FF88]">Sui</span></p>
                  </div>
                </div>

                {/* Social Links - X, Telegram, Discord */}
                <div className="flex space-x-4 pt-2">
                  {/* X (Twitter) */}
                  <a
                    href="https://x.com/tovira_sui"
                    className="group p-2 rounded-lg hover:bg-white/5 transition-all duration-200"
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Follow Tovira on X"
                  >
                    <img
                      src="/assets/icons/x.svg"
                      alt="X"
                      className="h-5 w-5 text-white/60 group-hover:text-[#00FF88] transition-colors duration-200"
                    />
                  </a>

                  {/* Telegram */}
                  <a
                    href="https://t.me/tovira"
                    className="group p-2 rounded-lg hover:bg-white/5 transition-all duration-200"
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Join Tovira on Telegram"
                  >
                    <img
                      src="/assets/icons/telegram.svg"
                      alt="Telegram"
                      className="h-5 w-5 text-white/60 group-hover:text-[#00FF88] transition-colors duration-200"
                    />
                  </a>

                  {/* Discord */}
                  <a
                    href="https://discord.gg/tovira"
                    className="group p-2 rounded-lg hover:bg-white/5 transition-all duration-200"
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Join Tovira Discord"
                  >
                    <img
                      src="/assets/icons/discord.svg"
                      alt="Discord"
                      className="h-5 w-5 text-white/60 group-hover:text-[#00FF88] transition-colors duration-200"
                    />
                  </a>
                </div>
              </div>
            </div>

            {/* Bottom Bar */}
            <div className="border-t border-white/10 pt-8 mt-8">
              <div className="flex flex-col lg:flex-row justify-between items-center gap-6">
                <div className="flex flex-col sm:flex-row items-center gap-4 text-center lg:text-left">
                  <p className="text-white/40 text-sm">
                    © 2025 Tovira. All rights reserved.
                  </p>
                  <div className="flex items-center gap-1">
                    <span className="text-white/40 text-sm">Built</span>
                    <span className="text-white/40 text-sm">on Sui</span>
                  </div>
                </div>

                <div className="flex flex-wrap justify-center lg:justify-end gap-6">
                  <Link to="/privacy" className="text-white/40 text-sm hover:text-white transition-colors duration-200 group">
                    <span className="group-hover:translate-x-1 transition-transform duration-200">Privacy Policy</span>
                  </Link>
                  <Link to="/terms" className="text-white/40 text-sm hover:text-white transition-colors duration-200 group">
                    <span className="group-hover:translate-x-1 transition-transform duration-200">Terms of Service</span>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
};

export default LandingPageLayout;