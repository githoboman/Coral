import React, { useState, useEffect, useRef } from 'react';

interface LoginModalProps {
  isOpen: boolean;
  loading: boolean;
  message: string | null;
  onSignIn: () => void;
  onClearMessage: () => void;
  isSupported: boolean;
}

interface LoginDrawerProps {
  isOpen: boolean;
  loading: boolean;
  message: string | null;
  onSignIn: () => void;
  onClearMessage: () => void;
  isSupported: boolean;
}

export function normalizeMessage(message: string | null) {
  if (!message) return null;

  const raw = message.toLowerCase();

  if (raw.includes("timeout")) return "The request took too long. Please try again.";
  if (raw.includes("not allowed") || raw.includes("denied"))
    return "The sign-in was cancelled. Please try again.";
  if (raw.includes("security") || raw.includes("privacy"))
    return "We couldn’t complete the sign-in. Please try again.";
  if (raw.includes("error") || raw.includes("fail"))
    return "Something went wrong. Please try again.";

  // Default fallback
  return "Something went wrong. Please try again.";
}

export function LoginModal({ isOpen, loading, message, onSignIn, onClearMessage, isSupported }: LoginModalProps) {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }

    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const friendlyMessage = normalizeMessage(message);

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
      <div
        className="fixed inset-0 bg-[#161010] backdrop-blur-sm"
      />

      <div className="relative w-full max-w-md bg-[#0C1419]/15 backdrop-blur-xl border border-white/10 rounded-[20px] shadow-2xl animate-in fade-in-50 slide-in-from-bottom-2 duration-300">
        <div className="relative z-0 p-6 sm:p-8">
         <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center gap-3 mb-6">
              <div className="w-15 h-15 bg-gradient-to-r from-transparent to-[#00103] backdrop-blur-md rounded-xl flex items-center justify-center">
                <img
                  src="/assets/images/signin-logo.png"
                  alt="Logo"
                  className=" h-full w-full bg-cover"
                />
              </div>
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-white to-[#00FF88] bg-clip-text text-transparent mb-2">
              Sign In
            </h2>
            <p className="text-white/60 text-sm sm:text-base leading-relaxed max-w-sm mx-auto">
              Securely access your Tovira account using your passkey.
              We'll create one if you don't have it yet.
            </p>
          </div>

          <div className="space-y-6">
            {!isSupported ? (
              <div className="p-4 bg-gradient-to-r from-yellow-500/10 to-yellow-600/10 border border-yellow-500/20 rounded-xl backdrop-blur-sm">
                <div className="flex items-start gap-3">
                  <div className="w-5 h-5 mt-0.5 bg-yellow-500/20 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-yellow-400 text-xs"> </span>
                  </div>
                  <div>
                    <p className="text-yellow-100 text-sm leading-relaxed">
                      Passkeys require a secure environment. Please use HTTPS or a modern browser to continue.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <button
                onClick={onSignIn}
                disabled={loading}
                className={`cursor-pointer w-full group relative overflow-hidden border border-[#4E4E4E] rounded-full py-4 px-6 font-semibold transition-all duration-200 flex items-center justify-center gap-2 ${loading
                  ? 'bg-white/10 cursor-not-allowed opacity-50'
                  : 'bg-[#191919] shadow-lg hover:shadow-xl hover:-translate-y-0.5'
                  } text-white disabled:cursor-not-allowed`}
              >
                {loading ? (
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-white/70 border-t-transparent rounded-full animate-spin"></div>
                    <span className="text-sm">Processing...</span>
                  </div>
                ) : (
                  <>
                    <span className="text-sm">
                      <img
                        src="/assets/icons/sui.svg"
                        alt="Sui"
                        className=''
                      />
                    </span>
                    <span className="text-sm">Sign In with Passkey</span>
                  </>
                )}
              </button>
            )}

            {message && (
              <div className={`p-4 border rounded-xl backdrop-blur-sm ${message.includes('Error') || message.includes('Failed')
                ? 'bg-gradient-to-r from-red-500/10 to-red-600/10 border-red-500/20'
                : 'bg-gradient-to-r from-green-500/10 to-green-600/10 border-green-500/20'
                }`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm ${message.includes('Error') || message.includes('Failed')
                      ? 'text-red-400'
                      : 'text-green-400'
                      }`}>
                      {message.includes('Error') || message.includes('Failed') ? '' : ''}
                    </span>
                    <p className={`text-sm ${message.includes('Error') || message.includes('Failed')
                      ? 'text-red-100'
                      : 'text-green-100'
                      }`}>
                      {friendlyMessage}
                    </p>
                  </div>
                  <button
                    onClick={onClearMessage}
                    className={`text-xs font-medium transition-colors duration-200 ${message.includes('Error') || message.includes('Failed')
                      ? 'text-red-300 hover:text-red-200'
                      : 'text-green-300 hover:text-green-200'
                      }`}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function LoginDrawer({ isOpen, loading, message, onSignIn, onClearMessage, isSupported }: LoginDrawerProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [startY, setStartY] = useState(0);
  const [currentY, setCurrentY] = useState(0);
  const [isOpenState, setIsOpenState] = useState(isOpen);
  const drawerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      setIsOpenState(true);
    } else {
      document.body.style.overflow = 'unset';
      setIsOpenState(false);
    }
  }, [isOpen]);

  // Handle drag start
  const handleDragStart = (e: React.TouchEvent | React.MouseEvent) => {
    if (!isSupported || loading) return;

    setIsDragging(true);
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    setStartY(clientY);
    setCurrentY(0);

    document.body.style.cursor = 'grabbing';
  };

  const handleDragMove = (e: React.TouchEvent | React.MouseEvent) => {
    if (!isDragging) return;

    e.preventDefault();
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const deltaY = clientY - startY;

    if (deltaY > 0) {
      setCurrentY(deltaY);
      if (drawerRef.current) {
        drawerRef.current.style.transform = `translateY(${deltaY}px)`;
      }
    }
  };


  const handleMouseMove = (e: React.MouseEvent) => handleDragMove(e);

  const handleTouchStart = (e: React.TouchEvent) => handleDragStart(e);

  useEffect(() => {
    const handlePreventScroll = (e: TouchEvent) => {
      if (isDragging) {
        e.preventDefault();
      }
    };

    if (isDragging) {
      document.addEventListener('touchmove', handlePreventScroll, { passive: false });
    }

    return () => {
      document.removeEventListener('touchmove', handlePreventScroll);
    };
  }, [isDragging]);

  const handleContentTouchMove = (e: React.TouchEvent) => {
    if (!isDragging && drawerRef.current) {
      const scrollTop = drawerRef.current.scrollTop;
      if (scrollTop === 0) {
        handleTouchStart(e);
      }
    }
  };

  if (!isOpenState) return null;

  const friendlyMessage = normalizeMessage(message);

  return (
    <div className={`fixed inset-0 z-[300] ${isOpen ? 'visible' : 'invisible'}`}>
      <div
        className={`fixed inset-0 bg-[#000000]/95 transition-opacity duration-300 backdrop-blur-sm ${isOpen ? 'opacity-100' : 'opacity-0'
          }`}
      />

      <div
        ref={drawerRef}
        className={`fixed bottom-0 left-0 right-0 bg-[#0C1419]/25 backdrop-blur-xl border-t border-white/10 rounded-t-[20px] shadow-2xl max-h-[90vh] overflow-y-auto ${isDragging ? 'transition-none' : 'transition-all duration-300 ease-out'
          }`}
        style={{ transform: isDragging ? `translateY(${currentY}px)` : 'translateY(0px)' }}
      >
        <div
          ref={handleRef}
          className={`flex justify-center py-4 touch-none select-none ${isDragging ? 'cursor-grabbing' : 'cursor-grab'
            }`}
        >
          <div className={`w-12 h-1.5 bg-white/5 rounded-full transition-all duration-200`}></div>
        </div>

        <div className="px-4 sm:px-6 pb-6">
          {/* Header */}
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center gap-3 mb-4">
              <div className="w-35 h-35 bg-gradient-to-r from-transparent to-[#00103] backdrop-blur-md rounded-xl flex items-center justify-center">
                <img
                  src="/assets/images/signin-logo.png"
                  alt="Logo"
                  className=" h-full w-full bg-cover"
                />
              </div>
            </div>
            <h2 className="text-xl sm:text-2xl font-bold bg-gradient-to-r from-white to-[#00FF88] bg-clip-text text-transparent mb-2">
              Sign In
            </h2>
            <p className="text-white/60 text-sm leading-relaxed max-w-sm mx-auto">
              Securely access your Tovira account using your passkey.
              We'll create one if you don't have it yet.
            </p>
          </div>

          {/* Content */}
          <div
            className="space-y-6"
            onTouchMove={handleContentTouchMove}
            onMouseMove={handleMouseMove}
          >
            {!isSupported ? (
              <div className="p-4 bg-gradient-to-r from-yellow-500/10 to-yellow-600/10 border border-yellow-500/20 rounded-xl backdrop-blur-sm">
                <div className="flex items-start gap-3">
                  <div className="w-5 h-5 mt-0.5 bg-yellow-500/20 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-yellow-400 text-xs"> </span>
                  </div>
                  <div>
                    <p className="text-yellow-100 text-sm leading-relaxed">
                      Passkeys require a secure environment. Please use HTTPS or a modern browser to continue.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <button
                onClick={onSignIn}
                disabled={loading}
                className={`cursor-pointer w-full group relative overflow-hidden border border-[#4E4E4E] rounded-full py-4 px-6 font-semibold transition-all duration-200 flex items-center justify-center gap-2 ${loading
                  ? 'bg-white/10 cursor-not-allowed opacity-50'
                  : 'bg-[#191919] shadow-lg hover:shadow-xl hover:-translate-y-0.5'
                  } text-white disabled:cursor-not-allowed`}
              >
                {loading ? (
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-white/70 border-t-transparent rounded-full animate-spin"></div>
                    <span className="text-sm">Processing...</span>
                  </div>
                ) : (
                  <>
                    <span className="text-sm">
                      <img
                        src="/assets/icons/sui.svg"
                        alt="Sui"
                        className=''
                      />
                    </span>
                    <span className="text-sm">Sign In with Passkey</span>
                  </>
                )}
              </button>
            )}

            {message && (
              <div className={`p-4 border rounded-xl backdrop-blur-sm ${message.includes('Error') || message.includes('Failed')
                ? 'bg-gradient-to-r from-red-500/10 to-red-600/10 border-red-500/20'
                : 'bg-gradient-to-r from-green-500/10 to-green-600/10 border-green-500/20'
                }`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm ${message.includes('Error') || message.includes('Failed')
                      ? 'text-red-400'
                      : 'text-green-400'
                      }`}>
                      {message.includes('Error') || message.includes('Failed') ? '' : ''}
                    </span>
                    <p className={`text-sm ${message.includes('Error') || message.includes('Failed')
                      ? 'text-red-100'
                      : 'text-green-100'
                      }`}>
                      {friendlyMessage}
                    </p>
                  </div>
                  <button
                    onClick={onClearMessage}
                    disabled={isDragging}
                    className={`text-xs font-medium transition-colors duration-200 ${message.includes('Error') || message.includes('Failed')
                      ? 'text-red-300 hover:text-red-200'
                      : 'text-green-300 hover:text-green-200'
                      }`}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Safe area for mobile */}
        <div className="h-4 sm:h-0"></div>
      </div>
    </div>
  );
}