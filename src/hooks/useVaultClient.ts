import { useMemo } from 'react';
import { VaultClient } from '../api/vaultClient';
import { useSettings } from './useSettings';

/**
 * Instantiates a VaultClient from stored settings + token.
 * Returns null if settings are still loading or no token is stored.
 */
export function useVaultClient(): VaultClient | null {
  const { settings, token, loading } = useSettings();

  return useMemo(() => {
    console.log('[vault] useVaultClient state', {
      loading,
      hasSettings: !!settings,
      hasToken: !!token,
      namespace: settings?.namespace,
    });
    if (loading || !settings || !token) return null;
    return new VaultClient(settings, token);
  }, [loading, settings, token]);
}
