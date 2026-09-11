/** Email: accounts, folders, templates and follow-ups. */
import { useState } from 'react';

import { Icon } from '../components/Icon';
import {
  Badge,
  Button,
  Card,
  CardHead,
  EmptyState,
  ErrorState,
  Field,
  Modal,
  Notice,
  Skeleton,
  SkeletonRows,
  Tabs,
  TextInput,
} from '../components/ui';
import { api } from '../lib/api';
import { relative } from '../lib/format';
import { useAsync, type AsyncState } from '../lib/hooks';
import { useApp } from '../app/AppState';
import type { EmailMessage, Page } from '../lib/types';

export function EmailView() {
  const { notify, revision, invalidate } = useApp();
  const [tab, setTab] = useState('followups');
  const [connecting, setConnecting] = useState(false);

  const accounts = useAsync(() => api.email.accounts(), [revision]);
  const followUps = useAsync(() => api.email.followUps(), [revision]);
  const templates = useAsync(() => api.email.templates(), [revision]);
  const inbox = useAsync(() => api.email.messages('inbox'), [revision]);
  const sent = useAsync(() => api.email.messages('sent'), [revision]);
  const drafts = useAsync(() => api.email.messages('draft'), [revision]);

  const connected = accounts.data?.some((account) => account.is_connected) ?? false;

  return (
    <div className="page-inner">
      <div className="page-head">
        <div>
          <h1 className="t-h1">Email</h1>
          <p className="t-small secondary" style={{ marginTop: 2 }}>
            Follow-ups and correspondence for your applications.
          </p>
        </div>
        <div className="spacer" />
        <Button variant="primary" icon="plus" onClick={() => setConnecting(true)}>
          Add an account
        </Button>
      </div>

      {!connected && (
        <div style={{ marginBottom: 16 }}>
          <Notice tone="info">
            No email account is connected, so nothing can be sent from here yet. Drafts and follow-up
            text are still prepared for you to copy into your own mail client.
          </Notice>
        </div>
      )}

      <Tabs
        tabs={[
          { id: 'followups', label: 'Follow-ups', count: followUps.data?.length },
          { id: 'inbox', label: 'Inbox', count: inbox.data?.total },
          { id: 'sent', label: 'Sent', count: sent.data?.total },
          { id: 'drafts', label: 'Drafts', count: drafts.data?.total },
          { id: 'templates', label: 'Templates', count: templates.data?.length },
          { id: 'accounts', label: 'Accounts', count: accounts.data?.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      <div style={{ paddingTop: 16 }}>
        {tab === 'followups' && (
          <Card>
            <CardHead
              title="Follow-ups due"
              icon="clock"
              subtitle="Applications with no response after your configured wait"
            />
            <div className="card-body flush">
              {followUps.loading ? (
                <SkeletonRows rows={3} />
              ) : followUps.error ? (
                <ErrorState message={followUps.error} onRetry={followUps.reload} />
              ) : !followUps.data?.length ? (
                <EmptyState
                  icon="clock"
                  title="Nothing due"
                  body="A follow-up appears here once an application has gone unanswered for the number of days set in Automation."
                />
              ) : (
                <div className="rows">
                  {followUps.data.map((item) => (
                    <div key={item.application_id} className="list-row">
                      <Icon name="clock" size={16} color="var(--status-warn)" />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="t-small truncate">
                          {item.job_title} at {item.company}
                        </div>
                        <div className="t-caption muted">
                          Due {relative(item.due)}
                          {item.follow_up_count > 0 && ` · ${item.follow_up_count} sent already`}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        icon="copy"
                        onClick={async () => {
                          await navigator.clipboard.writeText(
                            `Subject: ${item.suggested_subject}\n\n${item.suggested_body}`,
                          );
                          notify('Follow-up copied to the clipboard.', 'success');
                        }}
                      >
                        Copy draft
                      </Button>
                      <Button
                        size="sm"
                        variant="primary"
                        icon="send"
                        onClick={async () => {
                          try {
                            await api.email.createDraft({
                              application_id: item.application_id,
                              subject: item.suggested_subject,
                              body: item.suggested_body,
                              to_addresses: [],
                            });
                            notify('Saved to Drafts.', 'success');
                            drafts.reload();
                            invalidate();
                          } catch (error) {
                            notify(error instanceof Error ? error.message : String(error), 'danger');
                          }
                        }}
                      >
                        Save draft
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        )}

        {['inbox', 'sent', 'drafts'].includes(tab) && (
          <Card>
            <CardHead
              title={tab === 'inbox' ? 'Inbox' : tab === 'sent' ? 'Sent' : 'Drafts'}
              icon={tab === 'inbox' ? 'inbox' : tab === 'sent' ? 'send' : 'edit'}
            />
            <div className="card-body flush">
              <MessageList
                state={tab === 'inbox' ? inbox : tab === 'sent' ? sent : drafts}
                folder={tab}
                connected={connected}
                onSend={async (id) => {
                  try {
                    await api.email.sendDraft(id);
                    notify('Sent.', 'success');
                    drafts.reload();
                    sent.reload();
                  } catch (error) {
                    notify(error instanceof Error ? error.message : String(error), 'danger');
                  }
                }}
              />
            </div>
          </Card>
        )}

        {tab === 'templates' && (
          <div className="grid g-2" style={{ gap: 16 }}>
            {templates.loading && <Skeleton height={200} />}
            {templates.data?.map((template) => (
              <Card key={template.id}>
                <CardHead
                  title={template.name}
                  subtitle={template.category.replace('_', ' ')}
                  action={template.is_builtin ? <Badge>Built in</Badge> : undefined}
                />
                <div className="card-body col" style={{ gap: 10 }}>
                  <div className="col" style={{ gap: 3 }}>
                    <span className="t-caption muted">Subject</span>
                    <span className="t-small">{template.subject}</span>
                  </div>
                  <div
                    className="t-small secondary"
                    style={{
                      whiteSpace: 'pre-wrap',
                      background: 'var(--surface-2)',
                      padding: 12,
                      borderRadius: 'var(--r-sm)',
                      maxHeight: 160,
                      overflowY: 'auto',
                    }}
                  >
                    {template.body}
                  </div>
                  <div className="chip-group">
                    {template.variables.map((variable) => (
                      <span key={variable} className="chip mono" style={{ fontSize: 11 }}>
                        {`{${variable}}`}
                      </span>
                    ))}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}

        {tab === 'accounts' && (
          <Card>
            <CardHead title="Connected accounts" icon="shield" />
            <div className="card-body col" style={{ gap: 12 }}>
              <Notice tone="info">
                Passwords and tokens are never stored in this application&rsquo;s database. An account
                records only where its credential lives, and the secret stays in your operating
                system&rsquo;s credential manager.
              </Notice>

              {accounts.loading ? (
                <SkeletonRows rows={2} />
              ) : !accounts.data?.length ? (
                <EmptyState
                  icon="mail"
                  title="No accounts yet"
                  body="Add an account to enable sending follow-ups directly from the application."
                  action={
                    <Button variant="primary" icon="plus" onClick={() => setConnecting(true)}>
                      Add an account
                    </Button>
                  }
                />
              ) : (
                <div className="col" style={{ gap: 8 }}>
                  {accounts.data.map((account) => (
                    <div
                      key={account.id}
                      className="row"
                      style={{
                        gap: 10,
                        padding: '12px 14px',
                        background: 'var(--surface-2)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--r-md)',
                      }}
                    >
                      <Icon name="mail" size={16} color="var(--text-secondary)" />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="t-small truncate">{account.address}</div>
                        <div className="t-caption muted">
                          {account.provider === 'gmail_oauth' ? 'Gmail via OAuth' : 'SMTP'}
                          {account.smtp_host && ` · ${account.smtp_host}:${account.smtp_port}`}
                          {account.credential_ref && ` · credential: ${account.credential_ref}`}
                        </div>
                      </div>
                      <Badge
                        color={account.is_connected ? 'var(--status-success)' : 'var(--status-warn)'}
                        background={
                          account.is_connected ? 'var(--status-success-bg)' : 'var(--status-warn-bg)'
                        }
                        dot
                      >
                        {account.is_connected ? 'Connected' : 'Not connected'}
                      </Badge>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon="trash"
                        title="Remove"
                        onClick={async () => {
                          try {
                            await api.email.deleteAccount(account.id);
                            notify('Account removed.', 'success');
                            accounts.reload();
                          } catch (error) {
                            notify(error instanceof Error ? error.message : String(error), 'danger');
                          }
                        }}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        )}
      </div>

      {connecting && (
        <AccountModal
          onClose={() => setConnecting(false)}
          onSaved={() => {
            setConnecting(false);
            accounts.reload();
            notify('Account registered.', 'success');
          }}
        />
      )}
    </div>
  );
}

function MessageList({
  state,
  folder,
  connected,
  onSend,
}: {
  state: AsyncState<Page<EmailMessage>>;
  folder: string;
  connected: boolean;
  onSend: (id: number) => void;
}) {
  if (state.loading) return <SkeletonRows rows={4} />;
  if (state.error) return <ErrorState message={state.error} onRetry={state.reload} />;
  if (!state.data?.items.length) {
    return (
      <EmptyState
        icon={folder === 'inbox' ? 'inbox' : folder === 'sent' ? 'send' : 'edit'}
        title={folder === 'inbox' ? 'Nothing in the inbox' : folder === 'sent' ? 'Nothing sent yet' : 'No drafts'}
        body={
          folder === 'inbox'
            ? 'Connect an account to read replies to your applications here.'
            : folder === 'sent'
              ? 'Messages you send from this application appear here.'
              : 'Save a follow-up as a draft and it waits here until you send it.'
        }
      />
    );
  }

  return (
    <div className="rows">
      {state.data.items.map((item) => {
        return (
          <div key={item.id} className="list-row">
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="t-small truncate">{item.subject || '(no subject)'}</div>
              <div className="t-caption muted truncate">
                {item.to_addresses.join(', ') || 'No recipient set'} · {relative(item.created_at)}
              </div>
            </div>
            {item.classification && <Badge>{item.classification}</Badge>}
            {folder === 'draft' && (
              <Button
                size="sm"
                icon="send"
                disabled={!connected}
                title={connected ? 'Send now' : 'Connect an account first'}
                onClick={() => onSend(item.id)}
              >
                Send
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function AccountModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { notify } = useApp();
  const [provider, setProvider] = useState<'smtp' | 'gmail_oauth'>('smtp');
  const [address, setAddress] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('587');
  const [credentialRef, setCredentialRef] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <Modal
      title="Add an email account"
      subtitle="The secret itself is never sent here"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            icon="check"
            busy={busy}
            disabled={!address.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await api.email.createAccount({
                  address,
                  provider,
                  smtp_host: host,
                  smtp_port: Number(port) || 587,
                  credential_ref: credentialRef,
                });
                onSaved();
              } catch (error) {
                notify(error instanceof Error ? error.message : String(error), 'danger');
              } finally {
                setBusy(false);
              }
            }}
          >
            Register account
          </Button>
        </>
      }
    >
      <div className="col" style={{ gap: 16 }}>
        <div className="row" style={{ gap: 8 }}>
          {(['smtp', 'gmail_oauth'] as const).map((option) => (
            <button
              key={option}
              className={`chip ${provider === option ? 'on' : ''}`}
              style={{ height: 32, padding: '0 14px' }}
              onClick={() => setProvider(option)}
            >
              {option === 'smtp' ? 'SMTP' : 'Gmail via OAuth'}
            </button>
          ))}
        </div>

        <Field label="Email address">
          <TextInput value={address} onChange={setAddress} placeholder="you@example.com" />
        </Field>

        {provider === 'smtp' && (
          <div className="grid g-2" style={{ gap: 12 }}>
            <Field label="SMTP host">
              <TextInput value={host} onChange={setHost} placeholder="smtp.example.com" />
            </Field>
            <Field label="Port">
              <TextInput value={port} onChange={setPort} type="number" />
            </Field>
          </div>
        )}

        <Field
          label="Credential reference"
          hint="The name of the entry in Windows Credential Manager holding the password or token."
        >
          <TextInput value={credentialRef} onChange={setCredentialRef} placeholder="job-hunter-smtp" />
        </Field>

        <Notice tone="warn">
          Do not paste a password here. This form deliberately has no password field, and the backend
          rejects a request that carries one.
        </Notice>
      </div>
    </Modal>
  );
}
