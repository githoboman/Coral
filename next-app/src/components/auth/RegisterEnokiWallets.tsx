'use client';

import { useEffect } from 'react';
import { useSuiClient, useSuiClientContext } from '@mysten/dapp-kit';
import { isEnokiNetwork, registerEnokiWallets } from '@mysten/enoki';

export function RegisterEnokiWallets() {
  const { network } = useSuiClientContext();
  const suiClient = useSuiClient();

  useEffect(() => {
    if (!isEnokiNetwork(network)) {
      console.log('[Enoki] Network is not an Enoki network:', network);
      return;
    }

    const enokiApiKey = process.env.NEXT_PUBLIC_ENOKI_API_KEY;
    const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

    if (!enokiApiKey || !googleClientId) {
      console.warn('[Enoki] Missing credentials - API key or Google Client ID not configured');
      return;
    }

    try {
      const { unregister } = registerEnokiWallets({
        apiKey: enokiApiKey,
        providers: {
          google: {
            clientId: googleClientId,
          },
        },
        client: suiClient,
        network,
      });

      return unregister;
    } catch (error) {
      console.error('[Enoki] Failed to register wallets:', error);
    }
  }, [network, suiClient]);

  return null;
}
