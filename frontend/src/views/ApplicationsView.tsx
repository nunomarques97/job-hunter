/** The application pipeline, as a Kanban board with drag between columns. */
import { useEffect, useRef, useState } from 'react';

import { Icon } from '../components/Icon';
import {
  Badge,
  Button,
  Card,
  CompanyMark,
  EmptyState,
  ErrorState,
  Modal,
  Notice,
  ScorePill,
  Skeleton,
  Tabs,
  TextArea,
} from '../components/ui';
import { api } from '../lib/api';
import { STAGE_COLORS, STAGE_LABELS, dateTime, relative, salary } from '../lib/format';
import { useAsync } from '../lib/hooks';
import { useApp } from '../app/AppState';
import type { Application, ApplicationDetail } from '../lib/types';

export function ApplicationsView() {
  const { notify, revision, invalidate, navigate } = useApp();
  const board = useAsync(() => api.applications.board(), [revision]);

  const [dragging, setDragging] = useState<Application | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [landed, setLanded] = useState<number | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const scrolled = useRef(false);

  // Open on the first column that holds something, so a board whose only
  // occupied stage is off to the right does not look empty.
  useEffect(() => {
    if (scrolled.current || !board.data || !boardRef.current) return;
    const index = board.data.columns.findIndex((column) => column.count > 0);
    if (index <= 0) return;
    const column = boardRef.current.children[index] as HTMLElement | undefined;
    if (column) {
      boardRef.current.scrollTo({ left: Math.max(0, column.offsetLeft - 24) });
      scrolled.current = true;
    }
  }, [board.data]);

  const move = async (application: Application, stage: string) => {
    if (application.stage === stage) return;
    try {
      await api.applications.setStage(application.id, stage, 'Moved on the board.');
      setLanded(application.id);
      window.setTimeout(() => setLanded(null), 400);
      notify(`Moved to ${STAGE_LABELS[stage] ?? stage}.`, 'success');
      board.reload();
      invalidate();
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'danger');
    }
  };

  if (board.loading && !board.data) {
    return (
      <div className="page-inner">
        <h1 className="t-h1" style={{ marginBottom: 20 }}>
          Applications
        </h1>
        <div className="board">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="board-col">
              <div className="board-col-head">
                <Skeleton height={13} width={90} />
              </div>
              <div className="board-items">
                <Skeleton height={64} radius={10} />
                <Skeleton height={64} radius={10} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (board.error || !board.data) {
    return (
      <div className="page-inner">
        <ErrorState message={board.error ?? 'The board could not load.'} onRetry={board.reload} />
      </div>
    );
  }

  const actionNeeded = board.data.columns.find((column) => column.stage === 'action_required');

  return (
    <div className="page-inner">
      <div className="page-head">
        <div>
          <h1 className="t-h1">Applications</h1>
          <p className="t-small secondary" style={{ marginTop: 2 }}>
            {board.data.total === 0
              ? 'Nothing in the pipeline yet.'
              : `${board.data.total} in the pipeline across ${
                  board.data.columns.filter((column) => column.count > 0).length
                } stages. Drag a card to move it, or scroll sideways for the rest.`}
          </p>
        </div>
        <div className="spacer" />
        <Button icon="refresh" onClick={board.reload}>
          Refresh
        </Button>
      </div>

      {actionNeeded && actionNeeded.count > 0 && (
        <div style={{ marginBottom: 16 }}>
          <Notice tone="warn">
            {actionNeeded.count} {actionNeeded.count === 1 ? 'application needs' : 'applications need'} you
            to finish {actionNeeded.count === 1 ? 'it' : 'them'} by hand. The package is prepared in each
            case; the employer accepts submissions only through their own form.
          </Notice>
        </div>
      )}

      {board.data.total === 0 ? (
        <Card>
          <EmptyState
            icon="applications"
            title="No applications yet"
            body="Prepare a package from any job and it appears here, moving through the pipeline as you work it."
            action={
              <Button variant="primary" icon="search" onClick={() => navigate('jobs')}>
                Find jobs to apply to
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="board" ref={boardRef}>
          {board.data.columns.map((column) => {
            const tone = STAGE_COLORS[column.stage] ?? STAGE_COLORS.closed;
            return (
              <div
                key={column.stage}
                className={`board-col ${dropTarget === column.stage ? 'drop' : ''}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDropTarget(column.stage);
                }}
                onDragLeave={() => setDropTarget((current) => (current === column.stage ? null : current))}
                onDrop={(event) => {
                  event.preventDefault();
                  setDropTarget(null);
                  if (dragging) move(dragging, column.stage);
                  setDragging(null);
                }}
              >
                <div className="board-col-head">
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 999,
                      background: tone.color,
                      flex: 'none',
                    }}
                  />
                  <span className="t-overline" style={{ color: 'var(--text-secondary)', flex: 1 }}>
                    {STAGE_LABELS[column.stage] ?? column.stage}
                  </span>
                  <span className="mono t-caption muted">{column.count}</span>
                </div>
                <div className="board-items">
                  {column.items.length === 0 ? (
                    <p className="t-caption muted" style={{ padding: '10px 4px' }}>
                      Empty
                    </p>
                  ) : (
                    column.items.map((application) => (
                      <BoardCard
                        key={application.id}
                        application={application}
                        dragging={dragging?.id === application.id}
                        landed={landed === application.id}
                        onDragStart={() => setDragging(application)}
                        onDragEnd={() => setDragging(null)}
                        onOpen={() => setOpen(application.id)}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {open !== null && (
        <ApplicationDetailModal
          applicationId={open}
          onClose={() => setOpen(null)}
          onChanged={() => {
            board.reload();
            invalidate();
          }}
        />
      )}
    </div>
  );
}

function BoardCard({
  application,
  dragging,
  landed,
  onDragStart,
  onDragEnd,
  onOpen,
}: {
  application: Application;
  dragging: boolean;
  landed: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onOpen: () => void;
}) {
  const job = application.job;
  return (
    <div
      className={`board-card ${dragging ? 'dragging' : ''} ${landed ? 'landed' : ''}`}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="row" style={{ gap: 8, marginBottom: 6 }}>
        <CompanyMark name={job?.company ?? '?'} logoUrl={job?.company_logo_url} size={24} />
        <span className="t-caption muted truncate" style={{ flex: 1 }}>
          {job?.company ?? 'Unknown company'}
        </span>
        {job?.score && <ScorePill score={job.score.score} />}
      </div>
      <div className="t-small clamp-2" style={{ fontWeight: 550, marginBottom: 6 }}>
        {job?.title ?? 'Untitled role'}
      </div>
      <div className="row t-caption muted" style={{ gap: 6, flexWrap: 'wrap' }}>
        {job?.location && (
          <span className="truncate" style={{ maxWidth: 120 }}>
            {job.location}
          </span>
        )}
        <span className="spacer" />
        {application.has_cv && <Icon name="documents" size={11} title="CV ready" />}
        {application.has_cover_letter && <Icon name="mail" size={11} title="Cover letter ready" />}
        <span>{relative(application.updated_at)}</span>
      </div>
      {application.action_required_reason && (
        <div
          className="t-caption"
          style={{
            marginTop: 7,
            paddingTop: 7,
            borderTop: '1px solid var(--border)',
            color: 'var(--status-warn)',
          }}
        >
          <span className="clamp-2">{application.action_required_reason}</span>
        </div>
      )}
    </div>
  );
}

function ApplicationDetailModal({
  applicationId,
  onClose,
  onChanged,
}: {
  applicationId: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { notify } = useApp();
  const [tab, setTab] = useState('package');
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);

  const state = useAsync<ApplicationDetail>(() => api.applications.detail(applicationId), [applicationId]);

  const act = async (name: string, action: () => Promise<unknown>, message: string) => {
    setBusy(name);
    try {
      await action();
      notify(message, 'success');
      state.reload();
      onChanged();
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'danger');
    } finally {
      setBusy(null);
    }
  };

  if (state.loading && !state.data) {
    return (
      <Modal title="Loading application" onClose={onClose} wide>
        <Skeleton height={200} />
      </Modal>
    );
  }
  if (state.error || !state.data) {
    return (
      <Modal title="Application" onClose={onClose} wide>
        <ErrorState message={state.error ?? 'Not found.'} onRetry={state.reload} />
      </Modal>
    );
  }

  const application = state.data;
  const job = application.job;
  const tone = STAGE_COLORS[application.stage] ?? STAGE_COLORS.closed;
  const noteValue = notes ?? application.notes;

  return (
    <Modal
      title={job?.title ?? 'Application'}
      subtitle={`${job?.company ?? ''}${job?.location ? ` · ${job.location}` : ''}`}
      onClose={onClose}
      wide
      footer={
        <>
          <Badge color={tone.color} background={tone.background} dot>
            {STAGE_LABELS[application.stage] ?? application.stage}
          </Badge>
          <div className="spacer" />
          {application.application_url && (
            <Button
              icon="external"
              onClick={() => window.open(application.application_url, '_blank', 'noopener')}
            >
              Open employer form
            </Button>
          )}
          <Button
            icon="refresh"
            busy={busy === 'regen'}
            onClick={() =>
              act('regen', () => api.applications.prepare(application.job_id, true), 'Package regenerated.')
            }
          >
            Regenerate
          </Button>
          {application.stage !== 'submitted' && (
            <Button
              variant="primary"
              icon="check"
              busy={busy === 'submit'}
              onClick={() =>
                act(
                  'submit',
                  () => api.applications.setStage(application.id, 'submitted', 'Marked as sent.'),
                  'Marked as submitted.',
                )
              }
            >
              Mark as submitted
            </Button>
          )}
        </>
      }
    >
      {application.action_required_reason && (
        <div style={{ marginBottom: 14 }}>
          <Notice tone="warn">{application.action_required_reason}</Notice>
        </div>
      )}

      <Tabs
        tabs={[
          { id: 'package', label: 'Package' },
          { id: 'cv', label: 'Tailored CV' },
          { id: 'letter', label: 'Cover letter' },
          { id: 'history', label: 'History', count: application.stage_history.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      <div style={{ paddingTop: 16 }}>
        {tab === 'package' && (
          <div className="col" style={{ gap: 16 }}>
            <div className="grid g-2" style={{ gap: 12 }}>
              <Detail label="Delivery method" value={methodLabel(application.application_method)} />
              <Detail label="Source" value={job?.source ?? '—'} />
              <Detail
                label="Salary advertised"
                value={salary(job?.salary_min, job?.salary_max, job?.salary_currency ?? '') || 'Not stated'}
              />
              <Detail label="Submitted" value={dateTime(application.submitted_at)} />
              <Detail label="Created" value={dateTime(application.created_at)} />
              <Detail label="Follow-up due" value={dateTime(application.follow_up_due)} />
            </div>

            <div className="col" style={{ gap: 7 }}>
              <span className="t-overline muted">Package contents</span>
              <PackageLine
                label="Tailored CV"
                document={application.tailored_cv}
                onOpen={() => setTab('cv')}
              />
              <PackageLine
                label="Cover letter"
                document={application.cover_letter}
                onOpen={() => setTab('letter')}
              />
            </div>

            <div className="col" style={{ gap: 7 }}>
              <span className="t-overline muted">Notes</span>
              <TextArea value={noteValue} onChange={setNotes} placeholder="Anything worth remembering about this application." />
              {notes !== null && notes !== application.notes && (
                <Button
                  size="sm"
                  variant="primary"
                  busy={busy === 'notes'}
                  onClick={() =>
                    act('notes', () => api.applications.update(application.id, { notes }), 'Notes saved.')
                  }
                  style={{ alignSelf: 'flex-start' }}
                >
                  Save notes
                </Button>
              )}
            </div>
          </div>
        )}

        {tab === 'cv' && <DocumentPane document={application.tailored_cv} kind="CV" />}
        {tab === 'letter' && <DocumentPane document={application.cover_letter} kind="cover letter" />}

        {tab === 'history' && (
          <ul className="col" style={{ gap: 0 }}>
            {[...application.stage_history].reverse().map((entry, index) => (
              <li
                key={`${entry.at}-${index}`}
                className="row"
                style={{
                  gap: 12,
                  padding: '10px 0',
                  borderBottom: '1px solid var(--border)',
                  alignItems: 'flex-start',
                }}
              >
                <Badge
                  color={(STAGE_COLORS[entry.stage] ?? STAGE_COLORS.closed).color}
                  background={(STAGE_COLORS[entry.stage] ?? STAGE_COLORS.closed).background}
                  dot
                >
                  {STAGE_LABELS[entry.stage] ?? entry.stage}
                </Badge>
                <span className="t-small secondary" style={{ flex: 1 }}>
                  {entry.reason || 'No reason recorded.'}
                </span>
                <span className="t-caption muted">{dateTime(entry.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

function methodLabel(method: string): string {
  const labels: Record<string, string> = {
    email: 'Email to the address in the posting',
    api: 'The source’s own submission API',
    external_form: 'The employer’s own web form',
    manual: 'No documented submission mechanism',
  };
  return labels[method] ?? method;
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="col" style={{ gap: 2 }}>
      <span className="t-caption muted">{label}</span>
      <span className="t-small">{value}</span>
    </div>
  );
}

function PackageLine({
  label,
  document,
  onOpen,
}: {
  label: string;
  document: { word_count: number; truthfulness_passed: boolean; generated_by: string } | null;
  onOpen: () => void;
}) {
  return (
    <button
      className="row"
      onClick={onOpen}
      disabled={!document}
      style={{
        gap: 10,
        padding: '10px 12px',
        background: 'var(--surface-2)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-md)',
        width: '100%',
        textAlign: 'left',
        opacity: document ? 1 : 0.6,
      }}
    >
      <Icon
        name={document ? 'check' : 'close'}
        size={15}
        color={document ? 'var(--status-success)' : 'var(--text-muted)'}
      />
      <span className="t-small" style={{ flex: 1 }}>
        {label}
      </span>
      {document ? (
        <>
          {!document.truthfulness_passed && (
            <Badge color="var(--status-warn)" background="var(--status-warn-bg)">
              Needs a check
            </Badge>
          )}
          <span className="t-caption muted mono">{document.word_count} words</span>
          <Icon name="chevronRight" size={14} color="var(--text-muted)" />
        </>
      ) : (
        <span className="t-caption muted">Not generated</span>
      )}
    </button>
  );
}

function DocumentPane({
  document,
  kind,
}: {
  document: { content: string; truthfulness_passed: boolean; truthfulness_findings: string[]; version: number; generated_by: string; id: number } | null;
  kind: string;
}) {
  if (!document) {
    return (
      <EmptyState
        icon="file"
        title={`No ${kind} yet`}
        body={`Regenerate the package to produce a ${kind} for this application.`}
      />
    );
  }
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row" style={{ gap: 8 }}>
        <Badge>Version {document.version}</Badge>
        <Badge>
          {document.generated_by === 'model' ? 'Written by the local model' : 'From the template'}
        </Badge>
        <div className="spacer" />
        <Button
          size="sm"
          icon="download"
          onClick={() => window.open(api.documents.exportUrl(document.id, 'md'), '_blank')}
        >
          Markdown
        </Button>
        <Button
          size="sm"
          icon="eye"
          onClick={() => window.open(api.documents.exportUrl(document.id, 'html'), '_blank')}
        >
          Print view
        </Button>
      </div>

      {!document.truthfulness_passed && (
        <Notice tone="warn">
          <strong style={{ fontWeight: 600 }}>Check this before sending.</strong>
          <div style={{ marginTop: 3 }}>{document.truthfulness_findings.join(' ')}</div>
        </Notice>
      )}

      <Markdown content={document.content} />
    </div>
  );
}

/** A small Markdown renderer for the document preview.
 *  Only the subset a CV uses: headings, bullets, emphasis and paragraphs. */
export function Markdown({ content, maxHeight = 420 }: { content: string; maxHeight?: number }) {
  const lines = content.split('\n');
  const blocks: JSX.Element[] = [];
  let list: string[] = [];

  const flush = () => {
    if (!list.length) return;
    blocks.push(
      <ul key={`list-${blocks.length}`}>
        {list.map((item, index) => (
          <li key={index}>{inline(item)}</li>
        ))}
      </ul>,
    );
    list = [];
  };

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      list.push(trimmed.slice(2));
      return;
    }
    flush();
    if (!trimmed) return;
    if (trimmed.startsWith('### ')) blocks.push(<h3 key={index}>{inline(trimmed.slice(4))}</h3>);
    else if (trimmed.startsWith('## ')) blocks.push(<h2 key={index}>{inline(trimmed.slice(3))}</h2>);
    else if (trimmed.startsWith('# ')) blocks.push(<h1 key={index}>{inline(trimmed.slice(2))}</h1>);
    else blocks.push(<p key={index}>{inline(trimmed)}</p>);
  });
  flush();

  return (
    <div className="doc" style={{ maxHeight }}>
      {blocks}
    </div>
  );
}

/** Bold and italic only; anything else renders as written. */
function inline(text: string): JSX.Element {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).filter(Boolean);
  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith('**') && part.endsWith('**'))
          return <strong key={index}>{part.slice(2, -2)}</strong>;
        if (part.startsWith('*') && part.endsWith('*')) return <em key={index}>{part.slice(1, -1)}</em>;
        return <span key={index}>{part}</span>;
      })}
    </>
  );
}
