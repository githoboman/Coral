import React, { useState, useEffect, useRef } from 'react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

interface LoginModalProps {
  isOpen: boolean;
  loading: boolean;
  onSignIn: () => void;
  onSignInWithGoogle?: () => void;
  isSupported: boolean;
}

interface LoginDrawerProps {
  isOpen: boolean;
  loading: boolean;
  onSignIn: () => void;
  onSignInWithGoogle?: () => void;
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

export function LoginModal({ isOpen, loading, onSignIn, onSignInWithGoogle, isSupported }: LoginModalProps) {
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
              <>
                {/* Google OAuth Button */}
                {onSignInWithGoogle && (
                  <button
                    onClick={onSignInWithGoogle}
                    disabled={loading}
                    className="cursor-pointer w-full group relative overflow-hidden bg-white hover:bg-gray-50 border border-gray-300 rounded-full py-4 px-6 font-semibold transition-all duration-200 flex items-center justify-center gap-3 shadow-lg hover:shadow-xl hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <svg className="w-5 h-5" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                    </svg>
                    <span className="text-gray-700 text-sm font-medium">Continue with Google</span>
                  </button>
                )}

                {/* Separator */}
                {onSignInWithGoogle && (
                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-white/10"></div>
                    </div>
                    <div className="relative flex justify-center text-xs">
                      <span className="bg-[#0C1419]/15 px-2 text-white/40">OR</span>
                    </div>
                  </div>
                )}

                {/* Passkey Button */}
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
                      <LoadingSpinner size="sm" />
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
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function LoginDrawer({ isOpen, loading, onSignIn, onSignInWithGoogle, isSupported }: LoginDrawerProps) {
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
              <>
                {/* Google OAuth Button */}
                {onSignInWithGoogle && (
                  <button
                    onClick={onSignInWithGoogle}
                    disabled={loading}
                    className="cursor-pointer w-full group relative overflow-hidden bg-white hover:bg-gray-50 border border-gray-300 rounded-full py-4 px-6 font-semibold transition-all duration-200 flex items-center justify-center gap-3 shadow-lg hover:shadow-xl hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <svg className="w-5 h-5" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                    </svg>
                    <span className="text-gray-700 text-sm font-medium">Continue with Google</span>
                  </button>
                )}

                {/* Separator */}
                {onSignInWithGoogle && (
                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-white/10"></div>
                    </div>
                    <div className="relative flex justify-center text-xs">
                      <span className="bg-[#0C1419]/15 px-2 text-white/40">OR</span>
                    </div>
                  </div>
                )}

                {/* Passkey Button */}
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
                      <LoadingSpinner size="sm" />
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
              </>
            )}
          </div>
        </div>

        {/* Safe area for mobile */}
        <div className="h-4 sm:h-0"></div>
      </div>
    </div>
  );
}