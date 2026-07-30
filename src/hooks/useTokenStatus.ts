import { useEffect, useState } from 'react';
import { TokenInfo } from '../types/vault';
import { LOOKUP_TOKEN, LookupTokenMessage, LookupTokenResponse } from '../types/messages';

interface UseTokenStatusResult {
  tokenInfo: TokenInfo | null;
  loading: boolean;
  error: string | null;
}

/**
 * Read-only hook that fetches the current TokenInfo from the background worker.
 * Re-fetches whenever chrome.storage reports a vaultToken change (i.e. the
 * background worker renewed the token). Does NOT perform any renewal itself.
 */
export function useTokenStatus(): UseTokenStatusResult {
  const [tokenInfo, setTokenInfo] = useState<TokenInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTokenInfo = () => {
    console.log('[vault] useTokenStatus.fetchTokenInfo');
    setLoading(true);
    setError(null);
    chrome.runtime.sendMessage<LookupTokenMessage, LookupTokenResponse>(
      { type: LOOKUP_TOKEN },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error('[vault] lookup token runtime error', chrome.runtime.lastError.message);
          setError(chrome.runtime.lastError.message ?? 'Runtime error');
          setLoading(false);
          return;
        }
        if (!response || !response.success) {
          const errMsg = response?.error ?? 'Failed to lookup token';
          // "not initialised" is the normal pre-login state — not a UI error
          if (errMsg !== 'Vault client not initialised') {
            console.error('[vault] lookup token failed', errMsg);
            setError(errMsg);
          } else {
            console.log('[vault] lookup token: client not yet initialised (not logged in)');
          }
          setLoading(false);
          return;
        }
        console.log('[vault] lookup token success', response.data);
        setTokenInfo(response.data ?? null);
        setLoading(false);
      },
    );
  };

  useEffect(() => {
    console.log('[vault] useTokenStatus mounted');
    fetchTokenInfo();

    const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
      // Re-fetch when the token itself changes (login/logout) OR when the
      // background worker writes fresh tokenInfo after an automatic renewal.
      if ('vaultToken' in changes || 'vaultTokenInfo' in changes) {
        console.log('[vault] token storage changed, refreshing token status');
        fetchTokenInfo();
      }
    };

    chrome.storage.onChanged.addListener(listener);
    return () => {
      chrome.storage.onChanged.removeListener(listener);
    };
  }, []);

  return { tokenInfo, loading, error };
}
