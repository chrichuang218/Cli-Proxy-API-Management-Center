import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { IconRefreshCw, IconSearch } from '@/components/ui/icons';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { usageApi, type UsageDetail, type UsagePayload, type UsageTokens } from '@/services/api';
import { getErrorMessage } from '@/utils/helpers';
import styles from './RequestMonitorPage.module.scss';

interface RequestRow {
  id: string;
  api: string;
  model: string;
  resolvedModel: string;
  provider: string;
  account: string;
  status: 'success' | 'failure';
  error: string;
  timestamp: string;
  latencyMs: number | null;
  tokens: UsageTokens;
  cost: number | null;
  apiKeyHash: string;
}

const MAX_ROWS = 500;
const AUTO_REFRESH_MS = 5000;

const formatNumber = (value?: number | null) =>
  typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString() : '--';

const formatTokens = (tokens: UsageTokens) => {
  const total = tokens.total_tokens ?? 0;
  const input = tokens.input_tokens ?? 0;
  const output = tokens.output_tokens ?? 0;
  const cached = tokens.cached_tokens ?? tokens.cache_tokens ?? 0;
  return {
    total: formatNumber(total),
    detail: `I ${formatNumber(input)} · O ${formatNumber(output)} · C ${formatNumber(cached)}`,
  };
};

const formatLatency = (latencyMs: number | null) => {
  if (latencyMs === null) return '--';
  if (latencyMs >= 1000) return `${(latencyMs / 1000).toFixed(2)}s`;
  return `${Math.round(latencyMs)}ms`;
};

const formatTime = (timestamp: string) => {
  if (!timestamp) return '--';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return date.toLocaleString();
};

const shortHash = (hash: string) => {
  if (!hash) return '';
  return hash.length > 14 ? `${hash.slice(0, 8)}...${hash.slice(-4)}` : hash;
};

const pickProvider = (detail: UsageDetail, api: string) =>
  detail.auth_provider_snapshot || detail.source?.split(':')[0] || api.split(' ')[0] || '-';

const pickAccount = (detail: UsageDetail) =>
  detail.auth_label_snapshot || detail.account_snapshot || detail.source || detail.auth_file_snapshot || '-';

const isEmptyUsageDetail = (api: string, model: string, detail: UsageDetail) => {
  const tokens = detail.tokens || {};
  const totalTokens = tokens.total_tokens ?? 0;
  return (
    api === '-' &&
    model === '-' &&
    !detail.failed &&
    !detail.source &&
    !detail.resolved_model &&
    !detail.error &&
    !detail.api_key_hash &&
    !detail.auth_provider_snapshot &&
    !detail.auth_label_snapshot &&
    !detail.account_snapshot &&
    !detail.auth_file_snapshot &&
    typeof detail.latency_ms !== 'number' &&
    typeof detail.cost !== 'number' &&
    totalTokens === 0
  );
};

const normalizeRows = (usage: UsagePayload | null): RequestRow[] => {
  if (!usage?.apis) return [];
  const rows: RequestRow[] = [];

  Object.entries(usage.apis).forEach(([api, apiBucket]) => {
    Object.entries(apiBucket.models || {}).forEach(([model, modelBucket]) => {
      (modelBucket.details || []).forEach((detail, index) => {
        if (isEmptyUsageDetail(api, model, detail)) return;

        const timestamp = detail.timestamp || '';
        const status = detail.failed ? 'failure' : 'success';
        rows.push({
          id: `${api}:${model}:${timestamp}:${index}`,
          api,
          model,
          resolvedModel: detail.resolved_model || '',
          provider: pickProvider(detail, api),
          account: pickAccount(detail),
          status,
          error: detail.error || '',
          timestamp,
          latencyMs: typeof detail.latency_ms === 'number' ? detail.latency_ms : null,
          tokens: detail.tokens || {},
          cost: typeof detail.cost === 'number' ? detail.cost : null,
          apiKeyHash: detail.api_key_hash || '',
        });
      });
    });
  });

  return rows
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, MAX_ROWS);
};

export function RequestMonitorPage() {
  const { t } = useTranslation();
  const [usage, setUsage] = useState<UsagePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [onlyFailed, setOnlyFailed] = useState(false);
  const [autoRefresh, setAutoRefresh] = useLocalStorage('request-monitor-auto-refresh', true);

  const loadUsage = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      const data = await usageApi.getUsage();
      setUsage(data);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useHeaderRefresh(loadUsage);

  useEffect(() => {
    void loadUsage();
  }, [loadUsage]);

  useEffect(() => {
    if (!autoRefresh) return undefined;
    const timer = window.setInterval(() => {
      void loadUsage();
    }, AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [autoRefresh, loadUsage]);

  const rows = useMemo(() => normalizeRows(usage), [usage]);
  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (onlyFailed && row.status !== 'failure') return false;
      if (!normalizedQuery) return true;
      return [
        row.api,
        row.model,
        row.resolvedModel,
        row.provider,
        row.account,
        row.error,
        row.apiKeyHash,
      ].some((value) => value.toLowerCase().includes(normalizedQuery));
    });
  }, [onlyFailed, query, rows]);

  const successCount = usage?.success_count ?? rows.filter((row) => row.status === 'success').length;
  const failureCount = usage?.failure_count ?? rows.filter((row) => row.status === 'failure').length;
  const totalRequests = usage?.total_requests ?? successCount + failureCount;
  const successRate = totalRequests > 0 ? `${((successCount / totalRequests) * 100).toFixed(1)}%` : '--';

  return (
    <div className={styles.container}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>{t('request_monitor.title')}</h1>
          <p className={styles.subtitle}>{t('request_monitor.subtitle')}</p>
        </div>
        <div className={styles.actions}>
          <Button
            variant="secondary"
            size="sm"
            type="button"
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={autoRefresh ? styles.toggleButtonActive : ''}
          >
            {autoRefresh ? t('request_monitor.auto_refresh_on') : t('request_monitor.auto_refresh_off')}
          </Button>
          <Button variant="secondary" size="sm" type="button" onClick={loadUsage} loading={loading}>
            <IconRefreshCw size={14} />
            {t('common.refresh')}
          </Button>
        </div>
      </div>

      {error && <div className={styles.errorBox}>{error}</div>}

      <div className={styles.summaryGrid}>
        <div className={styles.summaryCard}>
          <div className={styles.summaryLabel}>{t('request_monitor.total_requests')}</div>
          <div className={styles.summaryValue}>{formatNumber(totalRequests)}</div>
          <div className={styles.summaryHint}>{t('request_monitor.latest_rows', { count: rows.length })}</div>
        </div>
        <div className={styles.summaryCard}>
          <div className={styles.summaryLabel}>{t('request_monitor.success_count')}</div>
          <div className={styles.summaryValue}>{formatNumber(successCount)}</div>
          <div className={styles.summaryHint}>{successRate}</div>
        </div>
        <div className={styles.summaryCard}>
          <div className={styles.summaryLabel}>{t('request_monitor.failure_count')}</div>
          <div className={styles.summaryValue}>{formatNumber(failureCount)}</div>
          <div className={styles.summaryHint}>{onlyFailed ? t('request_monitor.filtering_failed') : '--'}</div>
        </div>
        <div className={styles.summaryCard}>
          <div className={styles.summaryLabel}>{t('request_monitor.total_tokens')}</div>
          <div className={styles.summaryValue}>{formatNumber(usage?.total_tokens)}</div>
          <div className={styles.summaryHint}>{t('request_monitor.from_usage_service')}</div>
        </div>
        <div className={styles.summaryCard}>
          <div className={styles.summaryLabel}>{t('request_monitor.last_update')}</div>
          <div className={styles.summaryValue}>{rows[0] ? formatTime(rows[0].timestamp).split(' ').pop() : '--'}</div>
          <div className={styles.summaryHint}>{rows[0] ? formatTime(rows[0].timestamp) : '--'}</div>
        </div>
      </div>

      <Card className={styles.tableCard}>
        <div className={styles.toolbar}>
          <div className={styles.search}>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('request_monitor.search_placeholder')}
              rightElement={<IconSearch size={16} />}
            />
          </div>
          <div className={styles.actions}>
            <Button
              variant="secondary"
              size="sm"
              type="button"
              onClick={() => setOnlyFailed(!onlyFailed)}
              className={onlyFailed ? styles.toggleButtonActive : ''}
            >
              {t('request_monitor.only_failed')}
            </Button>
          </div>
        </div>

        {filteredRows.length === 0 ? (
          <div className={styles.empty}>
            <EmptyState
              title={loading ? t('common.loading') : t('request_monitor.empty_title')}
              description={loading ? t('request_monitor.loading_desc') : t('request_monitor.empty_desc')}
            />
          </div>
        ) : (
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t('request_monitor.provider')}</th>
                  <th>{t('request_monitor.model')}</th>
                  <th>{t('request_monitor.status')}</th>
                  <th>{t('request_monitor.latency')}</th>
                  <th>{t('request_monitor.time')}</th>
                  <th>{t('request_monitor.tokens')}</th>
                  <th>{t('request_monitor.cost')}</th>
                  <th>{t('request_monitor.api_key')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => {
                  const tokenText = formatTokens(row.tokens);
                  return (
                    <tr key={row.id}>
                      <td>
                        <div className={styles.primaryText}>{row.provider || '-'}</div>
                        <div className={styles.secondaryText}>{row.account}</div>
                      </td>
                      <td>
                        <div className={styles.primaryText}>{row.model}</div>
                        <div className={`${styles.secondaryText} ${styles.mono}`}>
                          {row.api}
                          {row.resolvedModel ? ` -> ${row.resolvedModel}` : ''}
                        </div>
                      </td>
                      <td>
                        <span
                          className={`${styles.statusPill} ${
                            row.status === 'success' ? styles.statusSuccess : styles.statusFailure
                          }`}
                          title={row.error || undefined}
                        >
                          <span className={styles.dot} />
                          {t(`request_monitor.${row.status}`)}
                        </span>
                      </td>
                      <td>{formatLatency(row.latencyMs)}</td>
                      <td>{formatTime(row.timestamp)}</td>
                      <td>
                        <div className={styles.primaryText}>{tokenText.total}</div>
                        <div className={`${styles.secondaryText} ${styles.mono}`}>{tokenText.detail}</div>
                      </td>
                      <td>{row.cost === null ? '--' : row.cost.toFixed(6)}</td>
                      <td className={styles.mono}>{shortHash(row.apiKeyHash) || '--'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
