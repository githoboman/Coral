import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

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
  const [timeoutId, setTimeoutId] = useState<NodeJS.Timeout | null>(null);

  const handleMouseEnter = () => {
    const id = setTimeout(() => setIsVisible(true), delay * 1000);
    setTimeoutId(id);
  };

  const handleMouseLeave = () => {
    if (timeoutId) clearTimeout(timeoutId);
    setIsVisible(false);
  };

  // Positioning logic
  const positionClasses = {
    top: '-top-2 left-1/2 -translate-x-1/2 -translate-y-full',
    bottom: '-bottom-2 left-1/2 -translate-x-1/2 translate-y-full',
    left: 'top-1/2 -left-2 -translate-x-full -translate-y-1/2',
    right: 'top-1/2 -right-2 translate-x-full -translate-y-1/2',
  };

  const initialAnimation = {
    top: { opacity: 0, y: 5, x: '-50%' },
    bottom: { opacity: 0, y: -5, x: '-50%' },
    left: { opacity: 0, x: 5, y: '-50%' },
    right: { opacity: 0, x: -5, y: '-50%' },
  };

  const animateTo = {
    top: { opacity: 1, y: 0, x: '-50%' },
    bottom: { opacity: 1, y: 0, x: '-50%' },
    left: { opacity: 1, x: 0, y: '-50%' },
    right: { opacity: 1, x: 0, y: '-50%' },
  };

  return (
    <div
      className={`relative inline-block ${className}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleMouseEnter}
      onBlur={handleMouseLeave}
    >
      {children}
      <AnimatePresence>
        {isVisible && (
          <motion.div
            initial={initialAnimation[side]}
            animate={animateTo[side]}
            exit={initialAnimation[side]}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className={`absolute ${positionClasses[side]} z-50 px-2.5 py-1.5 text-xs font-medium text-white bg-black/90 border border-white/10 rounded-lg shadow-xl whitespace-nowrap pointer-events-none backdrop-blur-sm`}
          >
            {content}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
