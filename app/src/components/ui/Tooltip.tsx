import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';

interface TooltipProps {
  content: string | React.ReactNode;
  children: React.ReactNode;
  delay?: number;
  className?: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
}

export const Tooltip: React.FC<TooltipProps> = ({
  content,
  children,
  delay = 0.2,
  className = '',
  side = 'top'
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const timeoutId = useRef<NodeJS.Timeout | null>(null);

  const updatePosition = () => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();

      // We'll use fixed positioning to avoid scroll offset issues
      // But need to handle "offset" locally.
      // Actually, if we use fixed, we just use rect.top/left.
      
      let top = 0;
      let left = 0;
      const OFFSET = 10; // Distance from element

      switch (side) {
        case 'top':
          top = rect.top - OFFSET;
          left = rect.left + rect.width / 2;
          break;
        case 'bottom':
          top = rect.bottom + OFFSET;
          left = rect.left + rect.width / 2;
          break;
        case 'left':
          top = rect.top + rect.height / 2;
          left = rect.left - OFFSET;
          break;
        case 'right':
          top = rect.top + rect.height / 2;
          left = rect.right + OFFSET;
          break;
      }
      setPosition({ top, left });
    }
  };

  const handleMouseEnter = () => {
    updatePosition();
    timeoutId.current = setTimeout(() => {
      updatePosition(); // Update again just in case
      setIsVisible(true);
    }, delay * 1000);
  };

  const handleMouseLeave = () => {
    if (timeoutId.current) clearTimeout(timeoutId.current);
    setIsVisible(false);
  };

  // Clear timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutId.current) clearTimeout(timeoutId.current);
    };
  }, []);

  // Update position on scroll/resize while visible
  useEffect(() => {
    if (isVisible) {
      const handleScroll = () => {
        setIsVisible(false); // Hide on scroll usually better UX or update
        // updatePosition(); 
      };
      window.addEventListener('scroll', handleScroll, true);
      window.addEventListener('resize', handleScroll);
      return () => {
        window.removeEventListener('scroll', handleScroll, true);
        window.removeEventListener('resize', handleScroll);
      };
    }
  }, [isVisible]);

  const initialAnimation = {
    top: { opacity: 0, y: 'calc(-100% + 5px)', x: '-50%' },
    bottom: { opacity: 0, y: -5, x: '-50%' },
    left: { opacity: 0, x: 'calc(-100% + 5px)', y: '-50%' },
    right: { opacity: 0, x: -5, y: '-50%' },
  };

  const animateTo = {
    top: { opacity: 1, y: '-100%', x: '-50%' },
    bottom: { opacity: 1, y: 0, x: '-50%' },
    left: { opacity: 1, x: '-100%', y: '-50%' },
    right: { opacity: 1, x: 0, y: '-50%' },
  };

  return (
    <div
      ref={triggerRef}
      className={`relative inline-block ${className}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleMouseEnter}
      onBlur={handleMouseLeave}
    >
      {children}
      {createPortal(
        <AnimatePresence>
          {isVisible && (
            <motion.div
              initial={initialAnimation[side]}
              animate={animateTo[side]}
              exit={initialAnimation[side]}
              transition={{ duration: 0.15, ease: 'easeOut' }}
              style={{
                position: 'fixed',
                top: position.top,
                left: position.left,
                pointerEvents: 'none',
              }}
              className="z-[9999] px-2.5 py-1.5 text-xs font-medium text-white bg-black/90 border border-white/10 rounded-lg shadow-xl whitespace-nowrap backdrop-blur-sm"
            >
              {content}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
};
