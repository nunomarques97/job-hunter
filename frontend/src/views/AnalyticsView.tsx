/** Analytics. Every rate carries its numerator and denominator. */
import { useState } from 'react';

import { BarList, Donut, Funnel, LineChart } from '../components/charts';
import {
  Badge,
  Button,
  Card,
  CardHead,
  ErrorState,
  Select,
  Skeleton,
} from '../components/ui';
import { api } from '../lib/api';
import { STAGE_COLORS, STAGE_LABELS, number as formatNumber, percent, shortDate } from '../lib/format';
import { useAsync } from '../lib/hooks';
import { useApp } from '../app/AppState';
import type { Rate } from '../lib/types';

export function AnalyticsView() {
  const { revision } = useApp();
  const [days, setDays] = useState(30);

  const overview = useAsync(() => api.analytics.overview(), [revision]);
  const daily = useAsync(() => api.analytics.daily(days), [days, revision]);
  const sources = useAsync(() => api.analytics.sources(), [revision]);
  const funnel = useAsync(() => api.analytics.funnel(), [revision]);
  const geography = useAsync(() => api.analytics.geography(), [revision]);
  const salary = useAsync(() => api.analytics.salary(), [revision]);
  const technologies = useAsync(() => api.analytics.technologies(), [revision]);
  const pipeline = useAsync(() => api.analytics.pipeline(), [revision]);

  if (overview.error)
    return (
      <div className="page-inner">
        <ErrorState message={overview.error} onRetry={overview.reload} />
      </div>
    );

  return (
    <div className="page-inner">
      <div className="page-head">
        <div>
          <h1 className="t-h1">Analytics</h1>
          <p className="t-small secondary" style={{ marginTop: 2 }}>
            Computed from your own rows. A rate over fewer than five applications is marked as such.
          </p>
        </div>
        <div className="spacer" />
        <div style={{ width: 150 }}>
          <Select
            value={String(days)}
            onChange={(value) => setDays(Number(value))}
            options={[
              { value: '7', label: 'Last 7 days' },
              { value: '30', label: 'Last 30 days' },
              { value: '90', label: 'Last 90 days' },
              { value: '180', label: 'Last 180 days' },
            ]}
          />
        </div>
        <Button icon="refresh" onClick={overview.reload}>
          Refresh
        </Button>
      </div>

      <div className="grid g-4" style={{ marginBottom: 16 }}>
        <RateCard title="Response rate" rate={overview.data?.response_rate} help="Replies received" />
        <RateCard title="Interview rate" rate={overview.data?.interview_rate} help="Reached interview" />
        <RateCard title="Offer rate" rate={overview.data?.offer_rate} help="Reached offer" />
        <Card wash>
          <div className="kpi">
            <div style={{ minWidth: 0, flex: 1 }}>
              <span className="t-metric">
                {overview.data ? overview.data.average_score.toFixed(1) : '—'}
              </span>
              <div className="t-small secondary">Average match score</div>
              <div className="t-caption muted">
                across {formatNumber(overview.data?.jobs_discovered ?? 0)} postings
              </div>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid g-12">
        <Card className="span-8">
          <CardHead title="Discovery and applications" subtitle={`Last ${days} days`} />
          <div className="card-body">
            {daily.loading ? (
              <Skeleton height={180} />
            ) : (
              <LineChart
                labels={(daily.data ?? []).map((point) => shortDate(point.date))}
                series={[
                  {
                    key: 'jobs',
                    label: 'Jobs discovered',
                    color: 'var(--status-pipeline)',
                    values: (daily.data ?? []).map((point) => point.jobs),
                  },
                  {
                    key: 'applications',
                    label: 'Applications sent',
                    color: 'var(--accent)',
                    values: (daily.data ?? []).map((point) => point.applications),
                  },
                ]}
                height={210}
              />
            )}
          </div>
        </Card>

        <Card className="span-4">
          <CardHead title="Pipeline distribution" />
          <div className="card-body">
            {pipeline.loading ? (
              <Skeleton height={140} />
            ) : (
              <Donut
                slices={(pipeline.data ?? [])
                  .filter((item) => item.count > 0)
                  .map((item) => ({
                    label: STAGE_LABELS[item.stage] ?? item.stage,
                    value: item.count,
                    color: (STAGE_COLORS[item.stage] ?? STAGE_COLORS.closed).color,
                  }))}
                centerValue={String(
                  (pipeline.data ?? []).reduce((sum, item) => sum + item.count, 0),
                )}
                centerLabel="in pipeline"
              />
            )}
          </div>
        </Card>

        <Card className="span-6">
          <CardHead title="Funnel conversion" subtitle="How many survive each narrowing" />
          <div className="card-body">
            {funnel.loading ? <Skeleton height={220} /> : <Funnel steps={funnel.data ?? []} />}
          </div>
        </Card>

        <Card className="span-6">
          <CardHead title="Source performance" subtitle="Volume is not the same as quality" />
          <div className="card-body flush">
            {sources.loading ? (
              <div style={{ padding: 20 }}>
                <Skeleton height={160} />
              </div>
            ) : !sources.data?.length ? (
              <p className="t-small muted" style={{ padding: '12px 20px' }}>
                No sources have produced postings yet.
              </p>
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th className="num">Postings</th>
                      <th className="num">Avg score</th>
                      <th className="num">Applications</th>
                      <th className="num">Sent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sources.data.map((source) => (
                      <tr key={source.source}>
                        <td className="primary">{source.source}</td>
                        <td className="num">{formatNumber(source.jobs)}</td>
                        <td
                          className="num"
                          style={{
                            color:
                              source.average_score === null
                                ? 'var(--text-muted)'
                                : 'var(--text-primary)',
                          }}
                          title={
                            source.average_score === null
                              ? 'None of these postings have been scored yet.'
                              : undefined
                          }
                        >
                          {source.average_score === null
                            ? 'not scored'
                            : source.average_score.toFixed(1)}
                        </td>
                        <td className="num">{formatNumber(source.applications)}</td>
                        <td className="num">{formatNumber(source.submitted)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Card>

        <Card className="span-4">
          <CardHead title="Most demanded technologies" />
          <div className="card-body">
            {technologies.loading ? (
              <Skeleton height={200} />
            ) : (
              <BarList
                items={(technologies.data ?? []).slice(0, 10).map((item) => ({
                  label: item.technology,
                  value: item.count,
                }))}
              />
            )}
          </div>
        </Card>

        <Card className="span-4">
          <CardHead title="Where the jobs are" />
          <div className="card-body">
            {geography.loading ? (
              <Skeleton height={200} />
            ) : (
              <BarList
                items={(geography.data ?? []).slice(0, 10).map((item) => ({
                  label: item.country,
                  value: item.count,
                  color: 'var(--status-pipeline)',
                }))}
              />
            )}
          </div>
        </Card>

        <Card className="span-4">
          <CardHead
            title="Advertised salary"
            subtitle={
              salary.data?.count
                ? `Across ${salary.data.count} postings that stated one`
                : 'No posting stated a salary yet'
            }
          />
          <div className="card-body">
            {salary.loading ? (
              <Skeleton height={200} />
            ) : !salary.data?.count ? (
              <p className="t-small muted">
                Most boards omit salary. Figures appear here as soon as some of your postings state one.
              </p>
            ) : (
              <div className="col" style={{ gap: 12 }}>
                <SalaryRow label="Lowest" value={salary.data.min} />
                <SalaryRow label="25th percentile" value={salary.data.p25} />
                <SalaryRow label="Median" value={salary.data.median} emphasis />
                <SalaryRow label="75th percentile" value={salary.data.p75} />
                <SalaryRow label="Highest" value={salary.data.max} />
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function RateCard({ title, rate, help }: { title: string; rate?: Rate; help: string }) {
  return (
    <Card wash>
      <div className="kpi">
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
            <span className="t-metric">{rate ? percent(rate.value) : '—'}</span>
            {rate?.low_confidence && rate.denominator > 0 && (
              <Badge color="var(--status-warn)" background="var(--status-warn-bg)">
                Too few
              </Badge>
            )}
          </div>
          <div className="t-small secondary">{title}</div>
          <div className="t-caption muted mono">
            {rate ? `${rate.numerator} of ${rate.denominator}` : '0 of 0'} · {help}
          </div>
        </div>
      </div>
    </Card>
  );
}

function SalaryRow({ label, value, emphasis }: { label: string; value: number; emphasis?: boolean }) {
  return (
    <div className="row" style={{ gap: 10 }}>
      <span className="t-small secondary" style={{ flex: 1 }}>
        {label}
      </span>
      <span
        className="mono"
        style={{
          fontSize: emphasis ? 15 : 13,
          fontWeight: emphasis ? 620 : 450,
          color: emphasis ? 'var(--text-primary)' : 'var(--text-secondary)',
        }}
      >
        {formatNumber(Math.round(value))}
      </span>
    </div>
  );
}
