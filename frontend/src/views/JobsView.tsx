/** Job Search: discovery, filtering, sorting, pagination and the detail panel. */
import { useEffect, useMemo, useState } from 'react';

import { Icon } from '../components/Icon';
import {
  Badge,
  Button,
  Card,
  CardHead,
  Chip,
  CompanyMark,
  EmptyState,
  ErrorState,
  Field,
  Modal,
  Notice,
  ScorePill,
  Select,
  SkeletonRows,
  Spinner,
  TextInput,
} from '../components/ui';
import { api, type JobQuery } from '../lib/api';
import {
  REMOTE_LABELS,
  SENIORITY_LABELS,
  number as formatNumber,
  relative,
  salary,
} from '../lib/format';
import { useAsync, useDebounced } from '../lib/hooks';
import { useApp } from '../app/AppState';
import { JobDetailPanel } from './JobDetailPanel';
import type { Job } from '../lib/types';

const PAGE_SIZE = 25;

const SORTS = [
  { value: 'score', label: 'Match score' },
  { value: 'posted', label: 'Date posted' },
  { value: 'discovered', label: 'Recently found' },
  { value: 'salary', label: 'Salary' },
  { value: 'company', label: 'Company' },
  { value: 'title', label: 'Role' },
];

export function JobsView() {
  const { focus, navigate, notify, revision, invalidate } = useApp();

  const [term, setTerm] = useState(() => window.sessionStorage.getItem('job-search-term') ?? '');
  const [sources, setSources] = useState<string[]>([]);
  const [remoteTypes, setRemoteTypes] = useState<string[]>([]);
  const [seniorities, setSeniorities] = useState<string[]>([]);
  const [technologies, setTechnologies] = useState<string[]>([]);
  const [companies, setCompanies] = useState<string[]>([]);
  const [minScore, setMinScore] = useState<number | undefined>();
  const [minSalary, setMinSalary] = useState<number | undefined>();
  const [savedOnly, setSavedOnly] = useState(false);
  const [sort, setSort] = useState('score');
  const [direction, setDirection] = useState('desc');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<number | null>(focus ?? null);
  const [discovering, setDiscovering] = useState(false);
  const [showDiscover, setShowDiscover] = useState(false);

  const debouncedTerm = useDebounced(term, 300);

  useEffect(() => {
    window.sessionStorage.removeItem('job-search-term');
  }, []);

  useEffect(() => {
    if (focus) setSelected(focus);
  }, [focus]);

  // Any filter change returns to the first page; staying on page 4 of a
  // now-shorter result set shows an empty list and reads as a bug.
  useEffect(() => {
    setPage(1);
  }, [debouncedTerm, sources, remoteTypes, seniorities, technologies, companies, minScore, minSalary, savedOnly, sort, direction]);

  const query: JobQuery = useMemo(
    () => ({
      q: debouncedTerm,
      sources,
      remote_types: remoteTypes,
      seniorities,
      technologies,
      companies,
      min_score: minScore,
      min_salary: minSalary,
      saved_only: savedOnly,
      sort,
      direction,
      page,
      page_size: PAGE_SIZE,
    }),
    [debouncedTerm, sources, remoteTypes, seniorities, technologies, companies, minScore, minSalary, savedOnly, sort, direction, page],
  );

  const results = useAsync(() => api.jobs.search(query), [query, revision]);
  const facets = useAsync(() => api.jobs.facets(), [revision]);

  const total = results.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const activeFilters =
    sources.length +
    remoteTypes.length +
    seniorities.length +
    technologies.length +
    companies.length +
    (minScore ? 1 : 0) +
    (minSalary ? 1 : 0) +
    (savedOnly ? 1 : 0);

  const clearFilters = () => {
    setSources([]);
    setRemoteTypes([]);
    setSeniorities([]);
    setTechnologies([]);
    setCompanies([]);
    setMinScore(undefined);
    setMinSalary(undefined);
    setSavedOnly(false);
  };

  const toggle = (list: string[], setter: (value: string[]) => void, value: string) =>
    setter(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);

  return (
    <div className="page-inner">
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <h1 className="t-h1">Job Search</h1>
          <p className="t-small secondary" style={{ marginTop: 2 }}>
            {results.loading && !results.data
              ? 'Loading your postings'
              : `${formatNumber(total)} postings${activeFilters ? ' matching your filters' : ' in your database'}`}
          </p>
        </div>
        <div className="spacer" />
        {results.refreshing && <Spinner size={14} />}
        <Button icon="refresh" onClick={results.reload}>
          Refresh
        </Button>
        <Button variant="primary" icon="plus" onClick={() => setShowDiscover(true)}>
          Discover jobs
        </Button>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '248px minmax(0, 1fr)', gap: 16 }}>
        {/* Filters */}
        <Card style={{ alignSelf: 'start', position: 'sticky', top: 0 }}>
          <CardHead
            title="Filters"
            icon="filter"
            action={
              activeFilters > 0 && (
                <Button size="sm" variant="ghost" onClick={clearFilters}>
                  Clear {activeFilters}
                </Button>
              )
            }
          />
          <div className="card-body col" style={{ gap: 16 }}>
            <Field label="Keyword">
              <TextInput value={term} onChange={setTerm} placeholder="Role, company or text" />
            </Field>

            <Field label="Minimum match score">
              <Select
                value={minScore === undefined ? '' : String(minScore)}
                onChange={(value) => setMinScore(value ? Number(value) : undefined)}
                options={[
                  { value: '', label: 'Any score' },
                  { value: '85', label: '85 and above — strong' },
                  { value: '70', label: '70 and above — good' },
                  { value: '55', label: '55 and above — fair' },
                ]}
              />
            </Field>

            <Field label="Minimum salary">
              <Select
                value={minSalary === undefined ? '' : String(minSalary)}
                onChange={(value) => setMinSalary(value ? Number(value) : undefined)}
                options={[
                  { value: '', label: 'Any salary' },
                  { value: '30000', label: '30k and above' },
                  { value: '45000', label: '45k and above' },
                  { value: '60000', label: '60k and above' },
                  { value: '80000', label: '80k and above' },
                ]}
              />
            </Field>

            <FilterGroup
              label="Working arrangement"
              options={(facets.data?.remote_types ?? []).map((item) => ({
                value: item.value,
                label: REMOTE_LABELS[item.value] ?? item.value,
                count: item.count,
              }))}
              selected={remoteTypes}
              onToggle={(value) => toggle(remoteTypes, setRemoteTypes, value)}
            />

            <FilterGroup
              label="Seniority"
              options={(facets.data?.seniorities ?? []).map((item) => ({
                value: item.value,
                label: SENIORITY_LABELS[item.value] ?? item.value,
                count: item.count,
              }))}
              selected={seniorities}
              onToggle={(value) => toggle(seniorities, setSeniorities, value)}
            />

            <FilterGroup
              label="Source"
              options={(facets.data?.sources ?? []).map((item) => ({
                value: item.value,
                label: item.value,
                count: item.count,
              }))}
              selected={sources}
              onToggle={(value) => toggle(sources, setSources, value)}
            />

            <FilterGroup
              label="Technology"
              limit={14}
              options={(facets.data?.technologies ?? []).map((item) => ({
                value: item.value,
                label: item.value,
                count: item.count,
              }))}
              selected={technologies}
              onToggle={(value) => toggle(technologies, setTechnologies, value)}
            />

            <FilterGroup
              label="Company"
              limit={10}
              options={(facets.data?.companies ?? []).map((item) => ({
                value: item.value,
                label: item.value,
                count: item.count,
              }))}
              selected={companies}
              onToggle={(value) => toggle(companies, setCompanies, value)}
            />

            <button className="chip" onClick={() => setSavedOnly((value) => !value)} style={{ alignSelf: 'flex-start' }}>
              <Icon name={savedOnly ? 'bookmarkFilled' : 'bookmark'} size={12} />
              Saved only
            </button>
          </div>
        </Card>

        {/* Results */}
        <Card>
          <div className="card-head">
            <div className="row" style={{ gap: 8, flex: 1, minWidth: 0 }}>
              <span className="t-overline muted">Sort by</span>
              <div style={{ width: 150 }}>
                <Select value={sort} onChange={setSort} options={SORTS} />
              </div>
              <Button
                size="sm"
                variant="ghost"
                icon={direction === 'desc' ? 'arrowDown' : 'arrowUp'}
                title={direction === 'desc' ? 'Descending' : 'Ascending'}
                onClick={() => setDirection(direction === 'desc' ? 'asc' : 'desc')}
              />
            </div>
            {total > 0 && (
              <span className="t-caption muted">
                {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {formatNumber(total)}
              </span>
            )}
          </div>

          <div className="card-body flush">
            {results.loading && !results.data ? (
              <SkeletonRows rows={8} />
            ) : results.error ? (
              <ErrorState message={results.error} onRetry={results.reload} />
            ) : !results.data?.items.length ? (
              <EmptyState
                icon="search"
                title={activeFilters || term ? 'Nothing matches those filters' : 'No postings yet'}
                body={
                  activeFilters || term
                    ? 'Widen or clear the filters to see more of what you have already discovered.'
                    : 'Discover pulls postings from public job boards and scores each one against your profile.'
                }
                action={
                  activeFilters || term ? (
                    <Button onClick={clearFilters}>Clear filters</Button>
                  ) : (
                    <Button variant="primary" icon="plus" onClick={() => setShowDiscover(true)}>
                      Discover jobs
                    </Button>
                  )
                }
              />
            ) : (
              <div className="rows">
                {results.data.items.map((job) => (
                  <JobRow
                    key={job.id}
                    job={job}
                    selected={selected === job.id}
                    onOpen={() => setSelected(job.id)}
                    onToggleSave={async () => {
                      try {
                        await api.jobs.save(job.id, !job.is_saved);
                        results.reload();
                      } catch (error) {
                        notify(error instanceof Error ? error.message : String(error), 'danger');
                      }
                    }}
                  />
                ))}
              </div>
            )}
          </div>

          {pages > 1 && (
            <div className="card-foot row" style={{ gap: 8 }}>
              <Button
                size="sm"
                icon="chevronLeft"
                disabled={page <= 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
              >
                Previous
              </Button>
              <span className="t-small secondary mono" style={{ margin: '0 auto' }}>
                Page {page} of {pages}
              </span>
              <Button
                size="sm"
                iconRight="chevronRight"
                disabled={page >= pages}
                onClick={() => setPage((value) => Math.min(pages, value + 1))}
              >
                Next
              </Button>
            </div>
          )}
        </Card>
      </div>

      {selected !== null && (
        <JobDetailPanel
          jobId={selected}
          onClose={() => {
            setSelected(null);
            if (focus) navigate('jobs');
          }}
          onChanged={() => {
            results.reload();
            invalidate();
          }}
        />
      )}

      {showDiscover && (
        <DiscoverModal
          busy={discovering}
          onClose={() => setShowDiscover(false)}
          onRun={async (payload) => {
            setDiscovering(true);
            try {
              const outcome = await api.jobs.discover(payload);
              const failed = outcome.sources.filter((item) => !item.ok);
              if (failed.length) {
                notify(
                  `Found ${outcome.created} new postings. ${failed
                    .map((item) => item.source)
                    .join(', ')} could not be read.`,
                  'warn',
                );
              } else {
                notify(
                  `Found ${outcome.created} new postings from ${outcome.fetched} fetched.`,
                  'success',
                );
              }
              setShowDiscover(false);
              results.reload();
              facets.reload();
              invalidate();
            } catch (error) {
              notify(error instanceof Error ? error.message : String(error), 'danger');
            } finally {
              setDiscovering(false);
            }
          }}
        />
      )}
    </div>
  );
}

function FilterGroup({
  label,
  options,
  selected,
  onToggle,
  limit = 8,
}: {
  label: string;
  options: { value: string; label: string; count: number }[];
  selected: string[];
  onToggle: (value: string) => void;
  limit?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!options.length) return null;
  const shown = expanded ? options : options.slice(0, limit);

  return (
    <div className="col" style={{ gap: 7 }}>
      <span className="t-overline muted">{label}</span>
      <div className="chip-group">
        {shown.map((option) => (
          <Chip
            key={option.value}
            active={selected.includes(option.value)}
            onClick={() => onToggle(option.value)}
          >
            <span className="truncate" style={{ maxWidth: 120 }}>
              {option.label}
            </span>
            <span className="mono muted" style={{ fontSize: 10.5 }}>
              {option.count}
            </span>
          </Chip>
        ))}
      </div>
      {options.length > limit && (
        <button className="t-caption" style={{ color: 'var(--accent)', textAlign: 'left' }} onClick={() => setExpanded((value) => !value)}>
          {expanded ? 'Show fewer' : `Show ${options.length - limit} more`}
        </button>
      )}
    </div>
  );
}

function JobRow({
  job,
  selected,
  onOpen,
  onToggleSave,
}: {
  job: Job;
  selected: boolean;
  onOpen: () => void;
  onToggleSave: () => void;
}) {
  const pay = salary(job.salary_min, job.salary_max, job.salary_currency);
  return (
    <div className={`list-row ${selected ? 'selected' : ''}`}>
      <button className="row" style={{ gap: 12, flex: 1, minWidth: 0, textAlign: 'left' }} onClick={onOpen}>
        <CompanyMark name={job.company} logoUrl={job.company_logo_url} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="row" style={{ gap: 8 }}>
            <span className="t-h3 truncate">{job.title}</span>
            {job.source === 'sample' && <Badge>Sample</Badge>}
          </div>
          <div className="row t-caption muted" style={{ gap: 7, marginTop: 2, flexWrap: 'wrap' }}>
            <span className="truncate" style={{ maxWidth: 150 }}>
              {job.company}
            </span>
            {job.location && (
              <>
                <span>·</span>
                <span className="row" style={{ gap: 3 }}>
                  <Icon name="pin" size={11} />
                  <span className="truncate" style={{ maxWidth: 160 }}>
                    {job.location}
                  </span>
                </span>
              </>
            )}
            <span>·</span>
            <span>{REMOTE_LABELS[job.remote_type]}</span>
            {pay && (
              <>
                <span>·</span>
                <span className="mono">{pay}</span>
              </>
            )}
          </div>
          {job.technologies.length > 0 && (
            <div className="row" style={{ gap: 4, marginTop: 5, flexWrap: 'wrap' }}>
              {job.technologies.slice(0, 5).map((tech) => (
                <span key={tech} className="chip" style={{ height: 19, fontSize: 11 }}>
                  {tech}
                </span>
              ))}
              {job.technologies.length > 5 && (
                <span className="t-caption muted">+{job.technologies.length - 5}</span>
              )}
            </div>
          )}
        </div>
        {job.score ? (
          <ScorePill score={job.score.score} />
        ) : (
          <span className="t-caption muted" style={{ width: 62, textAlign: 'center' }}>
            Unscored
          </span>
        )}
        <span className="t-caption muted" style={{ width: 74, textAlign: 'right' }}>
          {relative(job.posted_at ?? job.discovered_at)}
        </span>
      </button>
      <Button
        variant="ghost"
        size="sm"
        icon={job.is_saved ? 'bookmarkFilled' : 'bookmark'}
        title={job.is_saved ? 'Remove from saved' : 'Save this job'}
        onClick={onToggleSave}
      />
    </div>
  );
}

function DiscoverModal({
  onClose,
  onRun,
  busy,
}: {
  onClose: () => void;
  onRun: (payload: {
    sources: string[];
    terms: string[];
    greenhouse_boards: string[];
    lever_boards: string[];
  }) => void;
  busy: boolean;
}) {
  const sources = useAsync(() => api.jobs.sources(), []);
  const profile = useAsync(() => api.profile.read(), []);
  const [selected, setSelected] = useState<string[]>([]);
  const [terms, setTerms] = useState('');
  const [boards, setBoards] = useState('');

  useEffect(() => {
    if (sources.data && !selected.length) {
      setSelected(sources.data.filter((item) => item.name !== 'lever').map((item) => item.name));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources.data]);

  useEffect(() => {
    if (profile.data && !terms) setTerms((profile.data.target_roles ?? []).join(', '));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.data]);

  return (
    <Modal
      title="Discover jobs"
      subtitle="Reads public job boards and stores what it finds"
      onClose={onClose}
      footer={
        <>
          <span className="t-caption muted" style={{ flex: 1 }}>
            Sources are read through their public APIs. Nothing is submitted at this step.
          </span>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            icon="search"
            busy={busy}
            disabled={!selected.length}
            onClick={() =>
              onRun({
                sources: selected,
                terms: terms
                  .split(',')
                  .map((item) => item.trim())
                  .filter(Boolean),
                greenhouse_boards: boards
                  .split(',')
                  .map((item) => item.trim())
                  .filter(Boolean),
                lever_boards: [],
              })
            }
          >
            Discover
          </Button>
        </>
      }
    >
      <div className="col" style={{ gap: 18 }}>
        <Field
          label="Search terms"
          hint="Comma separated. Leave empty to keep everything a source offers and let the scorer decide."
        >
          <TextInput value={terms} onChange={setTerms} placeholder="frontend, angular, typescript" />
        </Field>

        <div className="col" style={{ gap: 8 }}>
          <span className="label">Sources</span>
          {sources.loading && <SkeletonRows rows={3} height={40} />}
          {sources.data?.map((source) => (
            <button
              key={source.name}
              className="row"
              onClick={() =>
                setSelected((current) =>
                  current.includes(source.name)
                    ? current.filter((item) => item !== source.name)
                    : [...current, source.name],
                )
              }
              style={{
                gap: 10,
                padding: '10px 12px',
                borderRadius: 'var(--r-md)',
                border: `1px solid ${selected.includes(source.name) ? 'var(--accent)' : 'var(--border)'}`,
                background: selected.includes(source.name) ? 'var(--accent-ghost)' : 'var(--surface-2)',
                width: '100%',
                textAlign: 'left',
              }}
            >
              <Icon
                name={selected.includes(source.name) ? 'check' : 'plus'}
                size={15}
                color={selected.includes(source.name) ? 'var(--accent)' : 'var(--text-muted)'}
              />
              <span style={{ minWidth: 0, flex: 1 }}>
                <span className="t-small" style={{ display: 'block' }}>
                  {source.label}
                </span>
                <span className="t-caption muted">{source.note}</span>
              </span>
            </button>
          ))}
        </div>

        <Field
          label="Greenhouse company boards"
          hint="Comma separated slugs, for example stripe, figma. Leave empty to use the default list."
        >
          <TextInput value={boards} onChange={setBoards} placeholder="stripe, figma, anthropic" />
        </Field>

        <Notice tone="info">
          Discovery reads only what each board publishes for programmatic access. No login, no
          scraping around a restriction, and nothing that an anonymous visitor could not see.
        </Notice>
      </div>
    </Modal>
  );
}
