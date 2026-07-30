import { TokenInfo } from '../types/vault';

const ALARM_NAME = 'vault-token-renew';

/**
 * Schedules (or reschedules) the `vault-token-renew` one-shot alarm.
 *
 * Delay is computed as `baseTtl × 2/3` seconds, where:
 *  - baseTtl = tokenInfo.period  (for periodic tokens)
 *  - baseTtl = tokenInfo.ttl     (for normal tokens)
 *
 * If explicit_max_ttl > 0, the delay is capped so the renewal happens
 * at least 60 seconds before the hard ceiling.
 *
 * Tokens with a baseTtl < 90 s are too short-lived for the 1-minute
 * chrome.alarms minimum — a warning is logged and no alarm is created.
 */
export function scheduleRenewal(tokenInfo: TokenInfo): void {
  const baseTtl = tokenInfo.period > 0 ? tokenInfo.period : tokenInfo.ttl;

  if (baseTtl < 90) {
    console.warn(
      `[vault] Token TTL (${baseTtl}s) is too short for chrome.alarms scheduling (min 90s). Skipping renewal alarm.`,
    );
    return;
  }

  let delaySeconds = baseTtl * (2 / 3);

  // Cap delay so we renew before the hard explicit_max_ttl ceiling
  if (tokenInfo.explicit_max_ttl > 0) {
    const maxDelay = tokenInfo.explicit_max_ttl - 60;
    if (maxDelay <= 0) {
      console.warn(
        `[vault] explicit_max_ttl (${tokenInfo.explicit_max_ttl}s) is too close to expiry. Skipping renewal alarm.`,
      );
      return;
    }
    delaySeconds = Math.min(delaySeconds, maxDelay);
  }

  const delayInMinutes = delaySeconds / 60;

  chrome.alarms.clear(ALARM_NAME, () => {
    chrome.alarms.create(ALARM_NAME, { delayInMinutes });
    console.log(
      `[vault] Renewal alarm scheduled in ${delayInMinutes.toFixed(2)} min (baseTtl=${baseTtl}s).`,
    );
  });
}

/**
 * Cancels the `vault-token-renew` alarm if one is pending.
 */
export function cancelRenewal(): void {
  chrome.alarms.clear(ALARM_NAME);
}
