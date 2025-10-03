// src/components/auth/Login.tsx
import React, { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  loading: boolean;
  message: string | null;
  onSignIn: () => void;
  onClearMessage: () => void;
  isSupported: boolean;
}

interface LoginDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  loading: boolean;
  message: string | null;
  onSignIn: () => void;
  onClearMessage: () => void;
  isSupported: boolean;
}

export function LoginModal({ isOpen, onClose, loading, message, onSignIn, onClearMessage, isSupported }: LoginModalProps) {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-gradient-to-b from-black/60 to-black/80 backdrop-blur-sm" 
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative w-full max-w-md bg-gradient-to-b from-[#010103]/95 via-[#010103]/90 to-[#010103]/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl animate-in fade-in-50 slide-in-from-bottom-2 duration-300">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 p-2 text-white/60 hover:text-white transition-all duration-200 rounded-lg hover:bg-white/5"
          aria-label="Close modal"
        >
          <X size={20} />
        </button>

        <div className="relative z-0 p-6 sm:p-8">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center gap-3 mb-6">
              <div className="w-15 h-15 bg-gradient-to-r from-transparent to-[#00103] backdrop-blur-md rounded-xl flex items-center justify-center">
                <img
                  src="/assets/logo.png"
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

          {/* Content */}
          <div className="space-y-6">
            {!isSupported ? (
              <div className="p-4 bg-gradient-to-r from-yellow-500/10 to-yellow-600/10 border border-yellow-500/20 rounded-xl backdrop-blur-sm">
                <div className="flex items-start gap-3">
                  <div className="w-5 h-5 mt-0.5 bg-yellow-500/20 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-yellow-400 text-xs">⚠️</span>
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
                className={`w-full group relative overflow-hidden rounded-xl py-4 px-6 font-semibold transition-all duration-200 flex items-center justify-center gap-2 ${
                  loading
                    ? 'bg-white/10 cursor-not-allowed opacity-50'
                    : 'bg-gradient-to-r from-[#00FF88] to-[#00CC6A] hover:from-[#00e679] hover:to-[#00b85a] shadow-lg hover:shadow-xl hover:-translate-y-0.5'
                } text-black disabled:cursor-not-allowed`}
              >
                {loading ? (
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin"></div>
                    <span className="text-sm">Processing...</span>
                  </div>
                ) : (
                  <>
                    <span className="text-sm">🔐</span>
                    <span className="text-sm">Sign In with Passkey</span>
                  </>
                )}
              </button>
            )}

            {message && (
              <div className={`p-4 border rounded-xl backdrop-blur-sm ${
                message.includes('Error') || message.includes('Failed') 
                  ? 'bg-gradient-to-r from-red-500/10 to-red-600/10 border-red-500/20' 
                  : 'bg-gradient-to-r from-green-500/10 to-green-600/10 border-green-500/20'
              }`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm ${
                      message.includes('Error') || message.includes('Failed')
                        ? 'text-red-400' 
                        : 'text-green-400'
                    }`}>
                      {message.includes('Error') || message.includes('Failed') ? '❌' : '✅'}
                    </span>
                    <p className={`text-sm ${
                      message.includes('Error') || message.includes('Failed')
                        ? 'text-red-100' 
                        : 'text-green-100'
                    }`}>
                      {message}
                    </p>
                  </div>
                  <button
                    onClick={onClearMessage}
                    className={`text-xs font-medium transition-colors duration-200 ${
                      message.includes('Error') || message.includes('Failed')
                        ? 'text-red-300 hover:text-red-200' 
                        : 'text-green-300 hover:text-green-200'
                    }`}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}

            {/* Divider */}
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-white/10"></div>
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-gradient-to-b from-[#010103]/95 px-3 text-white/40">or</span>
              </div>
            </div>

            {/* Alternative Actions */}
            <div className="space-y-3">
              <button className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 text-white/70 hover:bg-white/10 hover:text-white transition-all duration-200 text-sm font-medium flex items-center justify-center gap-2">
                <span>📧</span>
                <span>Email Sign In</span>
              </button>
              
              <button className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 text-white/70 hover:bg-white/10 hover:text-white transition-all duration-200 text-sm font-medium flex items-center justify-center gap-2">
                <span>🔗</span>
                <span>Connect Wallet</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function LoginDrawer({ isOpen, onClose, loading, message, onSignIn, onClearMessage, isSupported }: LoginDrawerProps) {
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

  // Handle drag move
  const handleDragMove = (e: React.TouchEvent | React.MouseEvent) => {
    if (!isDragging) return;
    
    e.preventDefault();
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const deltaY = clientY - startY;
    
    // Only allow dragging downward
    if (deltaY > 0) {
      setCurrentY(deltaY);
      if (drawerRef.current) {
        drawerRef.current.style.transform = `translateY(${deltaY}px)`;
      }
    }
  };

  // Handle drag end
  const handleDragEnd = () => {
    if (!isDragging) return;
    
    setIsDragging(false);
    document.body.style.cursor = 'default';
    
    const threshold = 100; // pixels to trigger dismiss
    
    if (currentY > threshold) {
      // Close if dragged past threshold
      closeDrawer();
    } else {
      // Snap back to original position
      if (drawerRef.current) {
        drawerRef.current.style.transform = 'translateY(0px)';
      }
    }
    
    setCurrentY(0);
  };

  // Handle mouse/touch events on handle
  const handleMouseDown = (e: React.MouseEvent) => handleDragStart(e);
  const handleMouseMove = (e: React.MouseEvent) => handleDragMove(e);
  const handleMouseUp = () => handleDragEnd();

  const handleTouchStart = (e: React.TouchEvent) => handleDragStart(e);
  const handleTouchMove = (e: React.TouchEvent) => handleDragMove(e);
  const handleTouchEnd = () => handleDragEnd();

  // Close drawer animation
  const closeDrawer = () => {
    if (drawerRef.current) {
      drawerRef.current.style.transition = 'transform 0.3s ease-out';
      drawerRef.current.style.transform = `translateY(100%)`;
      
      setTimeout(() => {
        onClose();
        if (drawerRef.current) {
          drawerRef.current.style.transition = '';
        }
      }, 350);
    }
  };

  // Prevent body scroll during drag
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

  // Prevent dragging when content is being scrolled
  const handleContentTouchMove = (e: React.TouchEvent) => {
    if (!isDragging && drawerRef.current) {
      const scrollTop = drawerRef.current.scrollTop;
      if (scrollTop === 0) {
        // Only allow drag if at top of content
        handleTouchStart(e);
      }
    }
  };

  if (!isOpenState) return null;

  return (
    <div className={`fixed inset-0 z-50 ${isOpen ? 'visible' : 'invisible'}`}>
      {/* Backdrop */}
      <div 
        className={`fixed inset-0 bg-gradient-to-b from-black/60 to-black/80 transition-opacity duration-300 backdrop-blur-sm ${
          isOpen ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={isDragging ? undefined : onClose}
      />
      
      {/* Drawer */}
      <div 
        ref={drawerRef}
        className={`fixed bottom-0 left-0 right-0 bg-gradient-to-t from-[#010103]/95 to-[#010103]/90 backdrop-blur-xl border-t border-white/10 rounded-t-2xl shadow-2xl max-h-[90vh] overflow-y-auto ${
          isDragging ? 'transition-none' : 'transition-all duration-300 ease-out'
        }`}
        style={{ transform: isDragging ? `translateY(${currentY}px)` : 'translateY(0px)' }}
      >
        {/* Drag Handle */}
        <div 
          ref={handleRef}
          className={`flex justify-center py-4 touch-none select-none ${
            isDragging ? 'cursor-grabbing' : 'cursor-grab'
          }`}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div className={`w-12 h-1.5 rounded-full transition-all duration-200 ${
            isDragging 
              ? 'bg-white/40 scale-110' 
              : 'bg-white/20 hover:bg-white/30 active:bg-white/40'
          }`}></div>
        </div>

        {/* Close Button */}
        <div className="flex justify-end px-4 pb-2">
          <button
            onClick={onClose}
            className="p-2 text-white/60 hover:text-white transition-all duration-200 rounded-lg hover:bg-white/5"
            aria-label="Close drawer"
            disabled={isDragging}
          >
            <X size={20} />
          </button>
        </div>

        <div className="px-4 sm:px-6 pb-6">
          {/* Header */}
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center gap-3 mb-4">
              <div className="w-15 h-15 bg-gradient-to-r from-transparent to-[#00103] backdrop-blur-md rounded-xl flex items-center justify-center">
                <img
                  src="/assets/logo.png"
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
                    <span className="text-yellow-400 text-xs">⚠️</span>
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
                disabled={loading || isDragging}
                className={`w-full group relative overflow-hidden rounded-xl py-4 px-6 font-semibold transition-all duration-200 flex items-center justify-center gap-2 ${
                  loading || isDragging
                    ? 'bg-white/10 cursor-not-allowed opacity-50'
                    : 'bg-gradient-to-r from-[#00FF88] to-[#00CC6A] hover:from-[#00e679] hover:to-[#00b85a] shadow-lg hover:shadow-xl hover:-translate-y-0.5'
                } text-black disabled:cursor-not-allowed`}
              >
                {loading ? (
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin"></div>
                    <span className="text-sm">Processing...</span>
                  </div>
                ) : (
                  <>
                    <span className="text-sm">🔐</span>
                    <span className="text-sm">Sign In with Passkey</span>
                  </>
                )}
              </button>
            )}

            {message && (
              <div className={`p-4 border rounded-xl backdrop-blur-sm ${
                message.includes('Error') || message.includes('Failed') 
                  ? 'bg-gradient-to-r from-red-500/10 to-red-600/10 border-red-500/20' 
                  : 'bg-gradient-to-r from-green-500/10 to-green-600/10 border-green-500/20'
              }`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm ${
                      message.includes('Error') || message.includes('Failed')
                        ? 'text-red-400' 
                        : 'text-green-400'
                    }`}>
                      {message.includes('Error') || message.includes('Failed') ? '❌' : '✅'}
                    </span>
                    <p className={`text-sm ${
                      message.includes('Error') || message.includes('Failed')
                        ? 'text-red-100' 
                        : 'text-green-100'
                    }`}>
                      {message}
                    </p>
                  </div>
                  <button
                    onClick={onClearMessage}
                    disabled={isDragging}
                    className={`text-xs font-medium transition-colors duration-200 ${
                      message.includes('Error') || message.includes('Failed')
                        ? 'text-red-300 hover:text-red-200' 
                        : 'text-green-300 hover:text-green-200'
                    }`}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}

            {/* Divider */}
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-white/10"></div>
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-gradient-to-t from-[#010103]/95 px-3 text-white/40">or</span>
              </div>
            </div>

            {/* Alternative Actions */}
            <div className="space-y-3">
              <button 
                className={`w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 text-white/70 hover:bg-white/10 hover:text-white transition-all duration-200 text-sm font-medium flex items-center justify-center gap-2 ${
                  isDragging ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                }`}
                disabled={isDragging}
              >
                <span>📧</span>
                <span>Email Sign In</span>
              </button>
              
              <button 
                className={`w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 text-white/70 hover:bg-white/10 hover:text-white transition-all duration-200 text-sm font-medium flex items-center justify-center gap-2 ${
                  isDragging ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                }`}
                disabled={isDragging}
              >
                <span>🔗</span>
                <span>Connect Wallet</span>
              </button>
            </div>
          </div>
        </div>

        {/* Safe area for mobile */}
        <div className="h-4 sm:h-0"></div>
      </div>
    </div>
  );
}