import { useState, useEffect } from 'react';
import {
  BrowserPasskeyProvider,
  BrowserPasswordProviderOptions,
  PasskeyKeypair,
} from '@mysten/sui/keypairs/passkey';

const STORAGE_PUBKEY = 'sui_passkey_pubkey_hex';
const STORAGE_ADDRESS = 'sui_passkey_address';

interface AuthState {
  isAuthenticated: boolean;
  address: string | null;
  pubkeyHex: string | null;
  loading: boolean;
  message: string | null;
  isSupported: boolean;
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string) {
  if (!hex) return new Uint8Array();
  const len = hex.length / 2;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function isPasskeySupported(): boolean {
  return !!(
    typeof window !== 'undefined' &&
    window.navigator &&
    window.navigator.credentials &&
    typeof window.navigator.credentials.create === 'function' &&
    typeof window.navigator.credentials.get === 'function' &&
    window.PublicKeyCredential &&
    typeof window.PublicKeyCredential === 'function'
  );
}

function isSecureContext(): boolean {
  return (
    window.isSecureContext ||
    window.location.protocol === 'https:' ||
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname.startsWith('192.168.') ||
    window.location.hostname.startsWith('10.') ||
    window.location.hostname.startsWith('172.')
  );
}

export function useAuth() {
  const [authState, setAuthState] = useState<AuthState>({
    isAuthenticated: false,
    address: null,
    pubkeyHex: null,
    loading: false,
    message: null,
    isSupported: false,
  });

  // Sync with Redux store
  const dispatch = (window as any).__REDUX_DISPATCH__;

  useEffect(() => {
    const supported = isPasskeySupported() && isSecureContext();

    const newState = { ...authState, isSupported: supported };
    setAuthState(newState);

    // Sync to Redux if available
    if (dispatch) {
      dispatch({ type: 'auth/setSupported', payload: supported });
    }

    if (!supported) {
      const message = !isSecureContext()
        ? 'Passkeys require HTTPS. Please use a secure connection or localhost for development.'
        : 'Your browser does not support passkeys. Please use a modern browser.';

      setAuthState((prev) => ({ ...prev, message }));
      if (dispatch) {
        dispatch({ type: 'auth/setMessage', payload: message });
      }
      return;
    }

    const storedAddr = localStorage.getItem(STORAGE_ADDRESS);
    const storedPk = localStorage.getItem(STORAGE_PUBKEY);

    if (storedAddr && storedPk) {
      const authData = {
        isAuthenticated: true,
        address: storedAddr,
        pubkeyHex: storedPk,
      };
      setAuthState((prev) => ({ ...prev, ...authData }));

      // Sync to Redux if available
      if (dispatch) {
        dispatch({
          type: 'auth/setAuth',
          payload: { address: storedAddr, pubkeyHex: storedPk }
        });
      }
    }
  }, []);

  const createProvider = () => {
    if (!authState.isSupported) {
      throw new Error('Passkeys are not supported in this environment');
    }

    const opts: BrowserPasswordProviderOptions = {
      rpName: 'Tovira',
      rpId:
        window.location.hostname === 'localhost'
          ? 'localhost'
          : window.location.hostname,
      authenticatorSelection: {
        authenticatorAttachment: undefined,
        residentKey: 'preferred',
        userVerification: 'required',
      },
      timeout: 60000,
    } as BrowserPasswordProviderOptions;

    return new BrowserPasskeyProvider('Tovira', opts);
  };

  const createNewPasskey = async () => {
    if (!authState.isSupported) {
      setAuthState((prev) => ({
        ...prev,
        message: 'Passkeys are not supported in this environment',
      }));
      return;
    }

    setAuthState((prev) => ({
      ...prev,
      loading: true,
      message: 'Creating new passkey...',
    }));

    try {
      const provider = createProvider();
      const keypair = await PasskeyKeypair.getPasskeyInstance(provider);
      const pk = keypair.getPublicKey();
      const addr = pk.toSuiAddress();
      const hex = bytesToHex(pk.toRawBytes());

      localStorage.setItem(STORAGE_PUBKEY, hex);
      localStorage.setItem(STORAGE_ADDRESS, addr);

      setAuthState((prev) => ({
        ...prev,
        isAuthenticated: true,
        address: addr,
        pubkeyHex: hex,
        message: 'Passkey created successfully!',
        loading: false,
      }));
    } catch (e: any) {
      console.error('Error creating passkey:', e);

      let errorMessage = 'Failed to create passkey';
      if (e?.message?.includes('NotAllowedError')) {
        errorMessage = 'Passkey creation was cancelled or failed. Please try again.';
      } else if (e?.message?.includes('InvalidStateError')) {
        errorMessage = 'A passkey already exists for this account.';
      } else if (e?.message?.includes('NotSupportedError')) {
        errorMessage = 'Passkeys are not supported on this device.';
      } else if (e?.message) {
        errorMessage = `Error: ${e.message}`;
      }

      setAuthState((prev) => ({
        ...prev,
        loading: false,
        message: errorMessage,
      }));
    }
  };

  const recoverPasskey = async () => {
    if (!authState.isSupported) {
      setAuthState((prev) => ({
        ...prev,
        message: 'Passkeys are not supported in this environment',
      }));
      return false;
    }

    setAuthState((prev) => ({
      ...prev,
      loading: true,
      message: 'Attempting to recover passkey...',
    }));

    try {
      const provider = createProvider();
      const m1 = new TextEncoder().encode(
        'sui-passkey-recovery-1:' + Date.now(),
      );
      const m2 = new TextEncoder().encode(
        'sui-passkey-recovery-2:' + Date.now(),
      );

      const pks1 = await PasskeyKeypair.signAndRecover(provider, m1);
      const pks2 = await PasskeyKeypair.signAndRecover(provider, m2);

      const set1 = new Set(pks1.map((pk) => bytesToHex(pk.toRawBytes())));
      const common = pks2
        .map((pk) => bytesToHex(pk.toRawBytes()))
        .find((h) => set1.has(h));

      if (!common) {
        setAuthState((prev) => ({
          ...prev,
          loading: false,
          message: 'No existing passkey found. Please create a new one.',
        }));
        return false;
      }

      const commonBytes = hexToBytes(common);
      const keypair = new PasskeyKeypair(commonBytes, provider);
      const pk = keypair.getPublicKey();
      const addr = pk.toSuiAddress();

      localStorage.setItem(STORAGE_PUBKEY, common);
      localStorage.setItem(STORAGE_ADDRESS, addr);

      setAuthState((prev) => ({
        ...prev,
        isAuthenticated: true,
        address: addr,
        pubkeyHex: common,
        message: 'Passkey recovered successfully!',
        loading: false,
      }));

      return true;
    } catch (e: any) {
      console.error('Error recovering passkey:', e);

      let errorMessage = 'Failed to recover passkey';
      if (e?.message?.includes('NotAllowedError')) {
        errorMessage = 'Passkey access was cancelled. Please try again.';
      } else if (e?.message?.includes('InvalidStateError')) {
        errorMessage = 'No passkey found for this site.';
      } else if (e?.message?.includes('NotSupportedError')) {
        errorMessage = 'Passkeys are not supported on this device.';
      } else if (e?.message) {
        errorMessage = `Error: ${e.message}`;
      }

      setAuthState((prev) => ({
        ...prev,
        loading: false,
        message: errorMessage,
      }));
      return false;
    }
  };

  const signIn = async () => {
    if (!authState.isSupported) {
      return;
    }

    if (authState.pubkeyHex) {
      setAuthState((prev) => ({
        ...prev,
        loading: true,
        message: 'Signing in...',
      }));

      try {
        const provider = createProvider();
        const pkBytes = hexToBytes(authState.pubkeyHex);
        const keypair = new PasskeyKeypair(pkBytes, provider);

        const challenge = new TextEncoder().encode(
          'sui-passkey-login:' + Date.now(),
        );
        await keypair.signPersonalMessage(challenge);

        setAuthState((prev) => ({
          ...prev,
          isAuthenticated: true,
          message: 'Signed in successfully!',
          loading: false,
        }));
      } catch (e: any) {
        console.error('Error signing in:', e);

        let errorMessage = 'Failed to sign in';
        if (e?.message?.includes('NotAllowedError')) {
          errorMessage = 'Sign in was cancelled. Please try again.';
        } else if (e?.message?.includes('InvalidStateError')) {
          errorMessage =
            'Invalid passkey. Please try recovering or creating a new one.';
        } else if (e?.message) {
          errorMessage = `Error: ${e.message}`;
        }

        setAuthState((prev) => ({
          ...prev,
          loading: false,
          message: errorMessage,
        }));
      }
    } else {
      const recovered = await recoverPasskey();
      if (!recovered) {
        await createNewPasskey();
      }
    }
  };

  const signOut = () => {
    localStorage.removeItem(STORAGE_PUBKEY);
    localStorage.removeItem(STORAGE_ADDRESS);
    setAuthState({
      isAuthenticated: false,
      address: null,
      pubkeyHex: null,
      loading: false,
      message: null,
      isSupported: authState.isSupported,
    });
  };

  const clearMessage = () => {
    setAuthState((prev) => ({
      ...prev,
      message: null,
    }));
  };

  const signTransaction = async (transactionBytes: Uint8Array): Promise<{ signature: string; publicKey: Uint8Array } | null> => {
    if (!authState.isSupported || !authState.pubkeyHex) {
      console.error('Cannot sign: passkey not available');
      return null;
    }

    try {
      const provider = createProvider();
      const pkBytes = hexToBytes(authState.pubkeyHex);
      const keypair = new PasskeyKeypair(pkBytes, provider);

      const { signature } = await keypair.signTransaction(transactionBytes);
      const publicKey = keypair.getPublicKey().toRawBytes();

      return {
        signature: signature.toString(),
        publicKey
      };
    } catch (e: any) {
      console.error('Error signing transaction:', e);

      let errorMessage = 'Failed to sign transaction';
      if (e?.message?.includes('NotAllowedError')) {
        errorMessage = 'Transaction signing was cancelled.';
      } else if (e?.message) {
        errorMessage = `Error: ${e.message}`;
      }

      setAuthState((prev) => ({
        ...prev,
        message: errorMessage,
      }));

      return null;
    }
  };

  const getKeypair = (): PasskeyKeypair | null => {
    if (!authState.isSupported || !authState.pubkeyHex) {
      return null;
    }

    try {
      const provider = createProvider();
      const pkBytes = hexToBytes(authState.pubkeyHex);
      return new PasskeyKeypair(pkBytes, provider);
    } catch (e) {
      console.error('Error getting keypair:', e);
      return null;
    }
  };

  return {
    ...authState,
    signIn,
    signOut,
    clearMessage,
    setAuthState,
    createNewPasskey,
    recoverPasskey,
    signTransaction,
    getKeypair,
  };
}