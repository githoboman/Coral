import React from 'react';

export const SplashScreen: React.FC = () => {
  return (
    <div className="splash-screen">
      <div className="splash-content">
        <div className="relative h-fit w-fit">
          <img src="/assets/images/signin-logo.png" alt="Tovira Logo" className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 splash-logo" />
          <div className="splash-loader"></div>
        </div>
      </div>

      <div className="fixed bottom-0 p-4 text-center w-full">
        <p>Your AI-powered portfolio tracker, sentiment insight, and notifications. <span className="text-[#B7FC0D]">Learn more</span></p>
      </div>
    </div>
  );
};
