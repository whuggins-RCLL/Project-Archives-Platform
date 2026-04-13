import { normalizeRoleFromClaims } from './roles';
import type { AppRole } from '../types';

type TokenResult = {
  claims?: Record<string, unknown>;
};

export type ClaimsUser = {
  getIdToken: (forceRefresh?: boolean) => Promise<string>;
  getIdTokenResult: (forceRefresh?: boolean) => Promise<TokenResult>;
};

type RefreshRoleOptions = {
  retries?: number;
  retryDelayMs?: number;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function fetchRoleFromUserClaims(user: ClaimsUser, forceRefresh = false): Promise<AppRole> {
  const tokenResult = await user.getIdTokenResult(forceRefresh);
  return normalizeRoleFromClaims(tokenResult?.claims ?? {});
}

export async function refreshRoleWithRetry(user: ClaimsUser, options: RefreshRoleOptions = {}): Promise<AppRole> {
  const retries = options.retries ?? 2;
  const retryDelayMs = options.retryDelayMs ?? 600;
  let attempt = 0;
  let lastError: unknown = null;

  while (attempt <= retries) {
    try {
      return await fetchRoleFromUserClaims(user, true);
    } catch (error) {
      lastError = error;
      if (attempt >= retries) {
        break;
      }
      await delay(retryDelayMs);
      attempt += 1;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Failed to refresh role claims');
}
