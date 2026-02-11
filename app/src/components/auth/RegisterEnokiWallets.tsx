import { useEffect } from 'react';
import { useSuiClientContext } from '@mysten/dapp-kit';
import { isEnokiNetwork, registerEnokiWallets } from '@mysten/enoki';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';

export function RegisterEnokiWallets() {
  const { network } = useSuiClientContext();

  useEffect(() => {
    if (!isEnokiNetwork(network)) {
      console.log('[Enoki] Network is not an Enoki network:', network);
      return;
    }

    const enokiApiKey = import.meta.env.VITE_ENOKI_API_KEY;
    const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

    if (!enokiApiKey || !googleClientId) {
      console.warn('[Enoki] Missing credentials - API key or Google Client ID not configured');
      return;
    }

    try {
      const suiClient = new SuiClient({ url: getFullnodeUrl(network) });

      const { unregister } = registerEnokiWallets({
        apiKey: enokiApiKey,
        providers: {
          google: {
            clientId: googleClientId,
            redirectUrl: `${window.location.origin}/signin`,
          },
        },
        client: suiClient as any,
        network,
      });

      return unregister;
    } catch (error) {
      console.error('[Enoki] Failed to register wallets:', error);
    }
  }, [network]);

  return null;
}
