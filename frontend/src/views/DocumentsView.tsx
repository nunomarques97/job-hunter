/** CV and cover letters: the master CV, tailored versions and version history. */
import { useState } from 'react';

import { Icon } from '../components/Icon';
import {
  Badge,
  Button,
  Card,
  CardHead,
  EmptyState,
  ErrorState,
  Notice,
  Skeleton,
  SkeletonRows,
  Tabs,
  TextArea,
} from '../components/ui';
import { api } from '../lib/api';
import { dateTime, relative } from '../lib/format';
import { useAsync, type AsyncState } from '../lib/hooks';
import { useApp } from '../app/AppState';
import { Markdown } from './ApplicationsView';
import type { DocumentSummary, Page } from '../lib/types';

export function DocumentsView() {
  const { navigate, notify, revision, invalidate } = useApp();
  const [tab, setTab] = useState('master');

  const completeness = useAsync(() => api.profile.completeness(), [revision]);
  const cvs = useAsync(() => api.documents.list({ kind: 'tailored_cv' }), [revision]);
  const letters = useAsync(() => api.documents.list({ kind: 'cover_letter' }), [revision]);

  return (
    <div className="page-inner">
      <div className="page-head">
        <div>
          <h1 className="t-h1">CV &amp; Cover Letter</h1>
          <p className="t-small secondary" style={{ marginTop: 2 }}>
            Every document is built from your profile. Nothing is added that you did not declare.
          </p>
        </div>
        <div className="spacer" />
        <Button icon="refresh" onClick={() => { cvs.reload(); letters.reload(); }}>
          Refresh
        </Button>
      </div>

      {completeness.data && !completeness.data.ready_for_generation && (
        <div style={{ marginBottom: 16 }}>
          <Notice
            tone="warn"
            action={
              <Button size="sm" variant="secondary" onClick={() => navigate('profile')}>
                Open Profile
              </Button>
            }
          >
            Generation is off until your profile has: {completeness.data.missing.join(', ')}.
          </Notice>
        </div>
      )}

      <Tabs
        tabs={[
          { id: 'master', label: 'Master CV' },
          { id: 'cvs', label: 'Tailored CVs', count: cvs.data?.total },
          { id: 'letters', label: 'Cover letters', count: letters.data?.total },
        ]}
        active={tab}
        onChange={setTab}
      />

      <div style={{ paddingTop: 16 }}>
        {tab === 'master' && <MasterCvPane onChanged={invalidate} />}
        {tab === 'cvs' && (
          <DocumentList
            state={cvs}
            emptyTitle="No tailored CVs yet"
            emptyBody="Open a job and prepare an application. The CV is reordered for that role, never rewritten with new facts."
            onBrowse={() => navigate('jobs')}
            notify={notify}
          />
        )}
        {tab === 'letters' && (
          <DocumentList
            state={letters}
            emptyTitle="No cover letters yet"
            emptyBody="A letter is written for one specific posting, using only what your profile states."
            onBrowse={() => navigate('jobs')}
            notify={notify}
          />
        )}
      </div>
    </div>
  );
}

function MasterCvPane({ onChanged }: { onChanged: () => void }) {
  const { notify, navigate } = useApp();
  const master = useAsync(() => api.profile.masterCv(), []);
  const [saving, setSaving] = useState(false);

  if (master.loading) return <Skeleton height={380} />;
  if (master.error) return <ErrorState message={master.error} onRetry={master.reload} />;

  const content = master.data?.content ?? '';
  const isEmpty = content.replace(/[#\s]/g, '').length < 20;

  return (
    <div className="grid g-12">
      <Card className="span-8">
        <CardHead
          title="Master CV"
          subtitle="Rendered from your profile every time it is opened"
          icon="file"
          action={
            <div className="row" style={{ gap: 8 }}>
              <Button size="sm" icon="edit" onClick={() => navigate('profile')}>
                Edit profile
              </Button>
              <Button
                size="sm"
                variant="primary"
                icon="download"
                busy={saving}
                onClick={async () => {
                  setSaving(true);
                  try {
                    await api.profile.saveMasterCv();
                    notify('Master CV saved as a new version.', 'success');
                    onChanged();
                  } catch (error) {
                    notify(error instanceof Error ? error.message : String(error), 'danger');
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                Save version
              </Button>
            </div>
          }
        />
        <div className="card-body">
          {isEmpty ? (
            <EmptyState
              icon="profile"
              title="Your profile is empty"
              body="The master CV is generated from your profile. Fill it in, or import an existing CV, and it appears here."
              action={
                <Button variant="primary" icon="upload" onClick={() => navigate('profile')}>
                  Set up your profile
                </Button>
              }
            />
          ) : (
            <Markdown content={content} maxHeight={520} />
          )}
        </div>
      </Card>

      <Card className="span-4" wash>
        <CardHead title="How generation works" icon="shield" />
        <div className="card-body col" style={{ gap: 12 }}>
          <Point
            icon="check"
            color="var(--status-success)"
            title="Your profile is the only source"
            body="Employers, dates, titles, education and certifications are rendered by code straight from what you entered."
          />
          <Point
            icon="check"
            color="var(--status-success)"
            title="The model only reorders"
            body="For a tailored CV the model may reorder sections and re-emphasise a bullet. It cannot introduce a fact."
          />
          <Point
            icon="shield"
            color="var(--accent)"
            title="Every document is checked"
            body="Generated text is compared against your declared facts. A document naming a technology or date you never entered is held back with the finding attached."
          />
          <Point
            icon="info"
            color="var(--status-info)"
            title="It works without the model"
            body="If the local model is unavailable, documents still generate from templates and say so."
          />
        </div>
      </Card>
    </div>
  );
}

function Point({
  icon,
  color,
  title,
  body,
}: {
  icon: 'check' | 'shield' | 'info';
  color: string;
  title: string;
  body: string;
}) {
  return (
    <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
      <Icon name={icon} size={15} color={color} style={{ marginTop: 2 }} />
      <div style={{ minWidth: 0 }}>
        <div className="t-small" style={{ fontWeight: 600 }}>
          {title}
        </div>
        <div className="t-caption secondary" style={{ marginTop: 2 }}>
          {body}
        </div>
      </div>
    </div>
  );
}

function DocumentList({
  state,
  emptyTitle,
  emptyBody,
  onBrowse,
  notify,
}: {
  state: AsyncState<Page<DocumentSummary>>;
  emptyTitle: string;
  emptyBody: string;
  onBrowse: () => void;
  notify: (message: string, tone?: 'info' | 'success' | 'warn' | 'danger') => void;
}) {
  const [openId, setOpenId] = useState<number | null>(null);

  if (state.loading && !state.data) {
    return (
      <Card>
        <div className="card-body flush">
          <SkeletonRows rows={5} />
        </div>
      </Card>
    );
  }
  if (state.error) return <ErrorState message={state.error} onRetry={state.reload} />;
  if (!state.data?.items.length) {
    return (
      <Card>
        <EmptyState
          icon="documents"
          title={emptyTitle}
          body={emptyBody}
          action={
            <Button variant="primary" icon="search" onClick={onBrowse}>
              Browse jobs
            </Button>
          }
        />
      </Card>
    );
  }

  return (
    <div className="grid g-12">
      <Card className="span-5" style={{ alignSelf: 'start' }}>
        <CardHead title={`${state.data.total} documents`} />
        <div className="card-body flush">
          <div className="rows">
            {state.data.items.map((document) => (
              <button
                key={document.id}
                className={`list-row ${openId === document.id ? 'selected' : ''}`}
                onClick={() => setOpenId(document.id)}
              >
                <Icon
                  name={document.kind === 'cover_letter' ? 'mail' : 'file'}
                  size={16}
                  color="var(--text-secondary)"
                />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="t-small truncate">{document.title}</div>
                  <div className="row t-caption muted" style={{ gap: 6, marginTop: 1 }}>
                    <span>v{document.version}</span>
                    <span>·</span>
                    <span className="mono">{document.word_count} words</span>
                    <span>·</span>
                    <span>{relative(document.created_at)}</span>
                  </div>
                </div>
                {!document.truthfulness_passed && (
                  <Icon name="alert" size={14} color="var(--status-warn)" />
                )}
              </button>
            ))}
          </div>
        </div>
      </Card>

      <div className="span-7">
        {openId === null ? (
          <Card>
            <EmptyState
              icon="eye"
              title="Select a document"
              body="Pick one from the list to preview it, see its version history and export it."
            />
          </Card>
        ) : (
          <DocumentDetailCard id={openId} notify={notify} onChanged={state.reload} />
        )}
      </div>
    </div>
  );
}

function DocumentDetailCard({
  id,
  notify,
  onChanged,
}: {
  id: number;
  notify: (message: string, tone?: 'info' | 'success' | 'warn' | 'danger') => void;
  onChanged: () => void;
}) {
  const document = useAsync(() => api.documents.detail(id), [id]);
  const versions = useAsync(() => api.documents.versions(id), [id]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  if (document.loading && !document.data) return <Skeleton height={420} />;
  if (document.error || !document.data)
    return <ErrorState message={document.error ?? 'Not found.'} onRetry={document.reload} />;

  const detail = document.data;

  return (
    <Card>
      <CardHead
        title={detail.title}
        subtitle={`Version ${detail.version} · ${
          detail.generated_by === 'model'
            ? `written by ${detail.model_name || 'the local model'}`
            : detail.generated_by === 'user'
              ? 'edited by you'
              : 'from the template'
        } · ${dateTime(detail.created_at)}`}
        action={
          <div className="row" style={{ gap: 6 }}>
            <Button
              size="sm"
              icon="download"
              title="Download as Markdown"
              onClick={() => window.open(api.documents.exportUrl(detail.id, 'md'), '_blank')}
            />
            <Button
              size="sm"
              icon="eye"
              title="Open a print-ready view"
              onClick={() => window.open(api.documents.exportUrl(detail.id, 'html'), '_blank')}
            />
            <Button
              size="sm"
              icon={editing ? 'close' : 'edit'}
              title={editing ? 'Cancel editing' : 'Edit'}
              onClick={() => {
                setDraft(detail.content);
                setEditing((value) => !value);
              }}
            />
          </div>
        }
      />
      <div className="card-body col" style={{ gap: 12 }}>
        {!detail.truthfulness_passed && (
          <Notice tone="warn">
            <strong style={{ fontWeight: 600 }}>Check this before sending.</strong>
            <div style={{ marginTop: 3 }}>{detail.truthfulness_findings.join(' ')}</div>
          </Notice>
        )}

        {editing ? (
          <div className="col" style={{ gap: 10 }}>
            <TextArea value={draft} onChange={setDraft} rows={20} />
            <div className="row" style={{ gap: 8 }}>
              <Button
                variant="primary"
                icon="check"
                busy={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api.documents.edit(detail.id, draft);
                    notify('Saved as a new version.', 'success');
                    setEditing(false);
                    document.reload();
                    versions.reload();
                    onChanged();
                  } catch (error) {
                    notify(error instanceof Error ? error.message : String(error), 'danger');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Save as new version
              </Button>
              <span className="t-caption muted">
                The current version is kept, so what you already sent stays readable.
              </span>
            </div>
          </div>
        ) : (
          <Markdown content={detail.content} maxHeight={440} />
        )}

        {versions.data && versions.data.length > 1 && (
          <div className="col" style={{ gap: 7 }}>
            <span className="t-overline muted">Version history</span>
            {versions.data.map((version) => (
              <div key={version.id} className="row" style={{ gap: 10 }}>
                <Badge
                  color={version.is_current ? 'var(--status-success)' : 'var(--text-muted)'}
                  background={version.is_current ? 'var(--status-success-bg)' : 'var(--surface-3)'}
                >
                  v{version.version}
                </Badge>
                <span className="t-small secondary" style={{ flex: 1 }}>
                  {version.generated_by === 'user' ? 'Your edit' : version.generated_by === 'model' ? 'Model' : 'Template'}
                  {' · '}
                  <span className="mono">{version.word_count} words</span>
                </span>
                <span className="t-caption muted">{dateTime(version.created_at)}</span>
                {!version.is_current && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="history"
                    title="Make this the current version"
                    onClick={async () => {
                      try {
                        await api.documents.restore(version.id);
                        notify(`Version ${version.version} is current again.`, 'success');
                        versions.reload();
                        document.reload();
                        onChanged();
                      } catch (error) {
                        notify(error instanceof Error ? error.message : String(error), 'danger');
                      }
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
