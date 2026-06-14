import { apiClient } from './client';

const USAGE_TIMEOUT_MS = 60 * 1000;

export interface UsageTokens {
  input_tokens?: number;
  output_tokens?: number;
  reasoning_tokens?: number;
  cached_tokens?: number;
  cache_tokens?: number;
  total_tokens?: number;
}

export interface UsageDetail {
  timestamp?: string;
  source?: string;
  auth_index?: string;
  api_key_hash?: string;
  account_snapshot?: string;
  auth_label_snapshot?: string;
  auth_file_snapshot?: string;
  auth_provider_snapshot?: string;
  auth_snapshot_at_ms?: number;
  latency_ms?: number;
  resolved_model?: string;
  tokens?: UsageTokens;
  failed?: boolean;
  error?: string;
  cost?: number;
}

export interface UsageModelBucket {
  details?: UsageDetail[];
}

export interface UsageApiBucket {
  models?: Record<string, UsageModelBucket>;
}

export interface UsagePayload {
  total_requests?: number;
  success_count?: number;
  failure_count?: number;
  total_tokens?: number;
  apis?: Record<string, UsageApiBucket>;
}

export const usageApi = {
  getUsage: () => apiClient.get<UsagePayload>('/usage', { timeout: USAGE_TIMEOUT_MS }),
};
