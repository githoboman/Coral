import React, { useState } from 'react';
import { useTelegram } from '@/hooks/useTelegram';
import { TelegramMainButton } from './TelegramMainButton';
import { TelegramBackButton } from './TelegramBackButton';

/**
 * Example component demonstrating Telegram Mini App features
 * You can use this as a reference for integrating Telegram features
 */
export const TelegramExample: React.FC = () => {
  const { user, theme, colorScheme, isInTelegram, platform, haptic } = useTelegram();
  const [count, setCount] = useState(0);

  const handleMainButtonClick = () => {
    haptic.notification('success');
    setCount(count + 1);
  };

  const handleBackButtonClick = () => {
    haptic.impact('light');
    setCount(0);
  };

  if (!isInTelegram) {
    return (
      <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
        <p className="text-yellow-500">
          This app is optimized for Telegram Mini Apps. Open it in Telegram for the best experience.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <div className="bg-gray-800 rounded-lg p-4">
        <h3 className="text-lg font-semibold mb-2">Telegram User Info</h3>
        {user && (
          <div className="space-y-1 text-sm">
            <p>Name: {user.first_name} {user.last_name}</p>
            <p>Username: @{user.username}</p>
            <p>Language: {user.language_code}</p>
            {user.is_premium && <p className="text-yellow-500">⭐ Premium User</p>}
          </div>
        )}
      </div>

      <div className="bg-gray-800 rounded-lg p-4">
        <h3 className="text-lg font-semibold mb-2">Theme Info</h3>
        <div className="space-y-1 text-sm">
          <p>Color Scheme: {colorScheme}</p>
          <p>Platform: {platform}</p>
          {theme && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div>
                <div
                  className="w-full h-8 rounded"
                  style={{ backgroundColor: theme.button_color }}
                />
                <p className="text-xs mt-1">Button Color</p>
              </div>
              <div>
                <div
                  className="w-full h-8 rounded"
                  style={{ backgroundColor: theme.bg_color }}
                />
                <p className="text-xs mt-1">Background</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="bg-gray-800 rounded-lg p-4">
        <h3 className="text-lg font-semibold mb-2">Haptic Feedback</h3>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => haptic.impact('light')}
            className="px-3 py-2 bg-blue-600 rounded text-sm"
          >
            Light Impact
          </button>
          <button
            onClick={() => haptic.impact('medium')}
            className="px-3 py-2 bg-blue-600 rounded text-sm"
          >
            Medium Impact
          </button>
          <button
            onClick={() => haptic.impact('heavy')}
            className="px-3 py-2 bg-blue-600 rounded text-sm"
          >
            Heavy Impact
          </button>
          <button
            onClick={() => haptic.notification('success')}
            className="px-3 py-2 bg-green-600 rounded text-sm"
          >
            Success
          </button>
          <button
            onClick={() => haptic.notification('error')}
            className="px-3 py-2 bg-red-600 rounded text-sm"
          >
            Error
          </button>
        </div>
      </div>

      <div className="bg-gray-800 rounded-lg p-4">
        <h3 className="text-lg font-semibold mb-2">Native Buttons</h3>
        <p className="text-sm text-gray-400 mb-2">
          Count: {count}
        </p>
        <p className="text-xs text-gray-500">
          The Main Button appears at the bottom of the Telegram app.
          The Back Button appears in the header.
        </p>
      </div>

      {/* Telegram Native Buttons */}
      <TelegramMainButton
        text={`Clicked ${count} times`}
        onClick={handleMainButtonClick}
        visible={true}
      />

      {count > 0 && (
        <TelegramBackButton
          onClick={handleBackButtonClick}
          visible={true}
        />
      )}
    </div>
  );
};
