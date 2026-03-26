import { useState, useEffect, useCallback } from 'react';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { sileo } from 'sileo';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

export interface UserPreferences {
  analytics_enabled?: boolean;
  notifications_enabled?: boolean;
  personalization_enabled?: boolean;
}

export interface UserProfile {
  email?: string;
  wallet_address: string;
  username?: string;
  first_name?: string;
  last_name?: string;
  preferences?: UserPreferences;
  referral_code?: string;
  referrals_count?: number;
  recently_analyzed?: string[];
  alert_wallets?: string[];
}

export function useProfile() {
  const currentAccount = useCurrentAccount();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = useCallback(async () => {
    if (!currentAccount?.address) {
      setProfile(null);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/fetch-user?user_id=${currentAccount.address}`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        if (data.exists && data.user) {
          setProfile(data.user);
        } else {
          // If user doesn't exist, we might want to handle it or just leave profile null
          // For Account page, usually implies we might want to create one or just show minimal info
          setProfile(null);
        }
      } else {
        setError("Failed to fetch profile");
      }
    } catch (err: any) {
      setError(err.message || "Error fetching profile");
    } finally {
      setLoading(false);
    }
  }, [currentAccount?.address]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const updatePreferences = async (newPrefs: UserPreferences) => {
    if (!currentAccount?.address) return;

    // Optimistic update
    const previousProfile = profile;
    setProfile(prev => prev ? { ...prev, preferences: { ...prev.preferences, ...newPrefs } } : null);

    try {
      const res = await fetch(`${API_BASE}/api/update-user`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: currentAccount.address,
          preferences: newPrefs,
          // maintain other fields if necessary, but backend should handle partial updates via merging
          // in users.ts it seems to merge with existing profile.
        })
      });

      if (!res.ok) {
        // Revert on failure
        setProfile(previousProfile);
        sileo.error({ title: "Update Failed", description: "Failed to update preferences" });
      } else {
        sileo.success({ title: "Success", description: "Preferences updated" });
      }
    } catch (err) {
      setProfile(previousProfile);
      sileo.error({ title: "Error", description: "Error updating preferences" });
      console.error(err);
    }
  };

  return {
    profile,
    loading,
    error,
    updatePreferences,
    refetch: fetchProfile
  };
}
