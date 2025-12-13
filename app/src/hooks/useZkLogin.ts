import { useState } from 'react';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { generateNonce, generateRandomness, getExtendedEphemeralPublicKey, jwtToAddress } from '@mysten/sui/zklogin';
import { jwtDecode } from 'jwt-decode';

const STORAGE_ZKLOGIN_EPHEMERAL_KEY = 'zklogin_ephemeral_key';
const STORAGE_ZKLOGIN_MAX_EPOCH = 'zklogin_max_epoch';
const STORAGE_ZKLOGIN_RANDOMNESS = 'zklogin_randomness';
const STORAGE_ZKLOGIN_USER_SALT = 'zklogin_user_salt';
const STORAGE_ZKLOGIN_ADDRESS = 'zklogin_address';
const STORAGE_ZKLOGIN_JWT = 'zklogin_jwt';
const STORAGE_ZKLOGIN_PROOF = 'zklogin_proof';

interface ZkLoginState {
  isAuthenticated: boolean;
  address: string | null;
  loading: boolean;
  message: string | null;
}

interface JWTPayload {
  iss: string;
  aud: string;
  sub: string;
  nonce?: string;
  exp?: number;
}

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const REDIRECT_URI = import.meta.env.VITE_REDIRECT_URI || 'http://localhost:5173/auth/callback';

export function useZkLogin() {
  const [zkLoginState, setZkLoginState] = useState<ZkLoginState>({
    isAuthenticated: false,
    address: null,
    loading: false,
    message: null,
  });

  /**
   * Generate ephemeral keypair and prepare for OAuth login
   */
  const prepareZkLogin = async (): Promise<string> => {
    try {
      setZkLoginState(prev => ({ ...prev, loading: true, message: 'Preparing login...' }));

      // Generate ephemeral keypair
      const ephemeralKeyPair = new Ed25519Keypair();
      const ephemeralPublicKey = ephemeralKeyPair.getPublicKey();

      // Generate randomness and max epoch
      const randomness = generateRandomness();
      const maxEpoch = 10; // Epochs until ephemeral key expires (adjust as needed)

      // Create nonce
      const nonce = generateNonce(ephemeralPublicKey, maxEpoch, randomness);

      // Store ephemeral data
      const secretKey = ephemeralKeyPair.getSecretKey();
      localStorage.setItem(STORAGE_ZKLOGIN_EPHEMERAL_KEY, secretKey);
      localStorage.setItem(STORAGE_ZKLOGIN_MAX_EPOCH, maxEpoch.toString());
      localStorage.setItem(STORAGE_ZKLOGIN_RANDOMNESS, randomness);

      // Build Google OAuth URL
      const params = new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID!,
        redirect_uri: REDIRECT_URI,
        response_type: 'id_token',
        scope: 'openid email profile',
        nonce: nonce,
      });

      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

      setZkLoginState(prev => ({ ...prev, loading: false }));
      return authUrl;
    } catch (error: any) {
      setZkLoginState(prev => ({
        ...prev,
        loading: false,
        message: `Failed to prepare login: ${error.message}`,
      }));
      throw error;
    }
  };

  /**
   * Complete zkLogin flow after OAuth callback
   */
  const completeZkLogin = async (jwtToken: string): Promise<void> => {
    try {
      setZkLoginState(prev => ({ ...prev, loading: true, message: 'Completing login...' }));

      // Decode JWT to validate
      jwtDecode<JWTPayload>(jwtToken);

      // Get user salt from backend
      const saltResponse = await fetch(`${apiBaseUrl}/api/zklogin/salt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jwt_token: jwtToken,
          oauth_provider: 'google',
        }),
      });

      if (!saltResponse.ok) {
        throw new Error('Failed to get user salt');
      }

      const { user_salt } = await saltResponse.json();

      // Derive zkLogin address
      const userSalt = BigInt(user_salt);
      const zkLoginAddress = jwtToAddress(jwtToken, userSalt);

      // Get ZK proof from proving service
      const randomness = localStorage.getItem(STORAGE_ZKLOGIN_RANDOMNESS);
      const maxEpoch = localStorage.getItem(STORAGE_ZKLOGIN_MAX_EPOCH);
      const secretKeyStr = localStorage.getItem(STORAGE_ZKLOGIN_EPHEMERAL_KEY);
      if (!secretKeyStr) throw new Error('Ephemeral key not found');
      const ephemeralKeyPair = Ed25519Keypair.fromSecretKey(secretKeyStr);

      const extendedEphemeralPublicKey = getExtendedEphemeralPublicKey(
        ephemeralKeyPair.getPublicKey()
      );

      const proofResponse = await fetch('https://prover-dev.mystenlabs.com/v1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jwt: jwtToken,
          extendedEphemeralPublicKey,
          maxEpoch: parseInt(maxEpoch!),
          jwtRandomness: randomness,
          salt: user_salt,
          keyClaimName: 'sub',
        }),
      });

      if (!proofResponse.ok) {
        throw new Error('Failed to get ZK proof');
      }

      const zkProof = await proofResponse.json();

      // Store zkLogin data
      localStorage.setItem(STORAGE_ZKLOGIN_USER_SALT, user_salt);
      localStorage.setItem(STORAGE_ZKLOGIN_ADDRESS, zkLoginAddress);
      localStorage.setItem(STORAGE_ZKLOGIN_JWT, jwtToken);
      localStorage.setItem(STORAGE_ZKLOGIN_PROOF, JSON.stringify(zkProof));

      setZkLoginState({
        isAuthenticated: true,
        address: zkLoginAddress,
        loading: false,
        message: 'Login successful!',
      });
    } catch (error: any) {
      setZkLoginState(prev => ({
        ...prev,
        loading: false,
        message: `Login failed: ${error.message}`,
      }));
      throw error;
    }
  };

  /**
   * Sign out and clear zkLogin data
   */
  const signOut = () => {
    localStorage.removeItem(STORAGE_ZKLOGIN_EPHEMERAL_KEY);
    localStorage.removeItem(STORAGE_ZKLOGIN_MAX_EPOCH);
    localStorage.removeItem(STORAGE_ZKLOGIN_RANDOMNESS);
    localStorage.removeItem(STORAGE_ZKLOGIN_USER_SALT);
    localStorage.removeItem(STORAGE_ZKLOGIN_ADDRESS);
    localStorage.removeItem(STORAGE_ZKLOGIN_JWT);
    localStorage.removeItem(STORAGE_ZKLOGIN_PROOF);

    setZkLoginState({
      isAuthenticated: false,
      address: null,
      loading: false,
      message: null,
    });
  };

  /**
   * Restore zkLogin session from localStorage
   */
  const restoreSession = () => {
    const address = localStorage.getItem(STORAGE_ZKLOGIN_ADDRESS);
    const jwt = localStorage.getItem(STORAGE_ZKLOGIN_JWT);

    if (address && jwt) {
      // Check if JWT is expired
      const decoded = jwtDecode<JWTPayload>(jwt);
      const now = Math.floor(Date.now() / 1000);

      if (decoded.exp && decoded.exp > now) {
        setZkLoginState({
          isAuthenticated: true,
          address,
          loading: false,
          message: null,
        });
        return true;
      } else {
        // JWT expired, clear session
        signOut();
        return false;
      }
    }

    return false;
  };

  return {
    ...zkLoginState,
    prepareZkLogin,
    completeZkLogin,
    signOut,
    restoreSession,
  };
}
