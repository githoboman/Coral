import React from 'react';

export const SplashScreen: React.FC = () => {
  return (
    <div className="splash-screen">
      <div className="splash-content">
        <div className="relative h-fit w-fit">
          <img src="/assets/coral-mark.svg" alt="Coral" className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 splash-logo rounded-[18px]" />
          <div className="splash-loader"></div>
        </div>
      </div>

      <div className="fixed bottom-0 p-4 text-center w-full">
        <p>Your autonomous agent for on-chain trading on Sui. <span className="text-[#FF9472]">Learn more</span></p>
      </div>
    </div>
  );
};
