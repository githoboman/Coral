import React from 'react';

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  text?: string;
  className?: string;
  fullScreen?: boolean;
}

const sizeClasses = {
  sm: 'w-4 h-4 border-2',
  md: 'w-10 h-10 border-2',
  lg: 'w-12 h-12 border-b-2',
};

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  size = 'md',
  text,
  className = '',
  fullScreen = false,
}) => {
  const spinner = (
    <div className={`${sizeClasses[size]} border-white ${size === 'lg' ? '' : 'border-t-transparent'} rounded-full animate-spin ${className}`}></div>
  );

  if (fullScreen) {
    return (
      <div className="h-dvh w-full flex justify-center items-center">
        <div className="flex flex-col items-center gap-3">
          {spinner}
          {text && <p className="text-sm text-gray-400">{text}</p>}
        </div>
      </div>
    );
  }

  if (text) {
    return (
      <div className="flex flex-col items-center gap-3">
        {spinner}
        <p className="text-sm text-gray-400">{text}</p>
      </div>
    );
  }

  return spinner;
};

export default LoadingSpinner;
