/** The candidate profile: the source of truth for every generated document. */
import { useEffect, useRef, useState } from 'react';

import { Icon } from '../components/Icon';
import {
  Badge,
  Button,
  Card,
  CardHead,
  ErrorState,
  Field,
  Modal,
  Notice,
  Skeleton,
  Switch,
  TagInput,
  Tabs,
  TextArea,
  TextInput,
} from '../components/ui';
import { api } from '../lib/api';
import { useAsync } from '../lib/hooks';
import { useApp } from '../app/AppState';
import type {
  Candidate,
  CertificationEntry,
  EducationEntry,
  ExperienceEntry,
  ImportPreview,
  LanguageEntry,
  ProjectEntry,
} from '../lib/types';

export function ProfileView() {
  const { notify, invalidate, revision } = useApp();
  const state = useAsync(() => api.profile.read(), [revision]);
  const completeness = useAsync(() => api.profile.completeness(), [revision]);

  const [draft, setDraft] = useState<Candidate | null>(null);
  const [tab, setTab] = useState('basics');
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (state.data) setDraft(state.data);
  }, [state.data]);

  if (state.loading && !draft) return <div className="page-inner"><Skeleton height={460} /></div>;
  if (state.error || !draft)
    return (
      <div className="page-inner">
        <ErrorState message={state.error ?? 'The profile could not load.'} onRetry={state.reload} />
      </div>
    );

  const set = <K extends keyof Candidate>(key: K, value: Candidate[K]) =>
    setDraft((current) => (current ? { ...current, [key]: value } : current));

  const dirty = JSON.stringify(draft) !== JSON.stringify(state.data);

  const save = async () => {
    setSaving(true);
    try {
      await api.profile.save(draft);
      notify('Profile saved. Scores use the new version from now on.', 'success');
      state.reload();
      completeness.reload();
      invalidate();
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'danger');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-inner">
      <div className="page-head">
        <div>
          <h1 className="t-h1">Profile</h1>
          <p className="t-small secondary" style={{ marginTop: 2 }}>
            Everything a CV or cover letter can say comes from here. Nothing is invented on top of it.
          </p>
        </div>
        <div className="spacer" />
        <Button icon="upload" onClick={() => setImporting(true)}>
          Import a CV
        </Button>
        <Button variant="primary" icon="check" busy={saving} disabled={!dirty} onClick={save}>
          {dirty ? 'Save changes' : 'Saved'}
        </Button>
      </div>

      {completeness.data && (
        <div style={{ marginBottom: 16 }}>
          <Card wash>
            <div className="card-body" style={{ paddingTop: 16 }}>
              <div className="row" style={{ gap: 12, marginBottom: 8 }}>
                <span className="t-h3">Profile completeness</span>
                <span className="mono" style={{ color: 'var(--text-primary)' }}>
                  {completeness.data.percent}%
                </span>
                <div className="bar-track" style={{ maxWidth: 320 }}>
                  <div
                    className="bar-fill"
                    style={{
                      width: `${completeness.data.percent}%`,
                      background: completeness.data.ready_for_generation
                        ? 'var(--status-success)'
                        : 'var(--status-warn)',
                    }}
                  />
                </div>
                <div className="spacer" />
                <Badge
                  color={completeness.data.ready_for_generation ? 'var(--status-success)' : 'var(--status-warn)'}
                  background={
                    completeness.data.ready_for_generation
                      ? 'var(--status-success-bg)'
                      : 'var(--status-warn-bg)'
                  }
                  dot
                >
                  {completeness.data.ready_for_generation ? 'Ready to generate' : 'Generation off'}
                </Badge>
              </div>
              {completeness.data.missing.length > 0 && (
                <p className="t-small secondary">Still needed: {completeness.data.missing.join(', ')}.</p>
              )}
            </div>
          </Card>
        </div>
      )}

      <Tabs
        tabs={[
          { id: 'basics', label: 'Basics' },
          { id: 'experience', label: 'Experience', count: draft.experience.length },
          { id: 'education', label: 'Education', count: draft.education.length },
          { id: 'skills', label: 'Skills' },
          { id: 'targets', label: 'Targets' },
          { id: 'extras', label: 'Projects & more' },
        ]}
        active={tab}
        onChange={setTab}
      />

      <div style={{ paddingTop: 16 }}>
        {tab === 'basics' && (
          <Card>
            <CardHead title="Who you are" icon="profile" />
            <div className="card-body grid g-2" style={{ gap: 14 }}>
              <Field label="Full name">
                <TextInput value={draft.full_name} onChange={(value) => set('full_name', value)} />
              </Field>
              <Field label="Email">
                <TextInput value={draft.email} onChange={(value) => set('email', value)} />
              </Field>
              <Field label="Phone">
                <TextInput value={draft.phone} onChange={(value) => set('phone', value)} />
              </Field>
              <Field label="Location">
                <TextInput
                  value={draft.location}
                  onChange={(value) => set('location', value)}
                  placeholder="Braga, Portugal"
                />
              </Field>
              <Field label="Current role">
                <TextInput value={draft.current_role} onChange={(value) => set('current_role', value)} />
              </Field>
              <Field label="Years of experience">
                <TextInput
                  type="number"
                  value={String(draft.years_of_experience)}
                  onChange={(value) => set('years_of_experience', Number(value) || 0)}
                />
              </Field>
              <div style={{ gridColumn: 'span 2' }}>
                <Field label="Headline" hint="One line, as it appears at the top of your CV.">
                  <TextInput
                    value={draft.headline}
                    onChange={(value) => set('headline', value)}
                    placeholder="Frontend Engineer, Angular and TypeScript"
                  />
                </Field>
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <Field label="Professional summary" hint="Two or three sentences. Used as written.">
                  <TextArea value={draft.summary} onChange={(value) => set('summary', value)} rows={4} />
                </Field>
              </div>
              <Field label="LinkedIn">
                <TextInput value={draft.linkedin_url} onChange={(value) => set('linkedin_url', value)} />
              </Field>
              <Field label="GitHub">
                <TextInput value={draft.github_url} onChange={(value) => set('github_url', value)} />
              </Field>
              <Field label="Website">
                <TextInput value={draft.website_url} onChange={(value) => set('website_url', value)} />
              </Field>
            </div>
          </Card>
        )}

        {tab === 'experience' && (
          <ListEditor<ExperienceEntry>
            title="Experience"
            icon="briefcase"
            items={draft.experience}
            onChange={(items) => set('experience', items)}
            blank={{ title: '', company: '', location: '', start: '', end: '', highlights: [] }}
            summarise={(entry) =>
              `${entry.title || 'Untitled role'}${entry.company ? ` — ${entry.company}` : ''}`
            }
            render={(entry, update) => (
              <div className="grid g-2" style={{ gap: 12 }}>
                <Field label="Job title">
                  <TextInput value={entry.title} onChange={(value) => update({ ...entry, title: value })} />
                </Field>
                <Field label="Company">
                  <TextInput value={entry.company} onChange={(value) => update({ ...entry, company: value })} />
                </Field>
                <Field label="Location">
                  <TextInput value={entry.location} onChange={(value) => update({ ...entry, location: value })} />
                </Field>
                <div className="grid g-2" style={{ gap: 8 }}>
                  <Field label="From">
                    <TextInput value={entry.start} onChange={(value) => update({ ...entry, start: value })} placeholder="2021" />
                  </Field>
                  <Field label="To">
                    <TextInput value={entry.end} onChange={(value) => update({ ...entry, end: value })} placeholder="Present" />
                  </Field>
                </div>
                <div style={{ gridColumn: 'span 2' }}>
                  <Field
                    label="What you did"
                    hint="One achievement per line. These are used verbatim; they are only ever reordered."
                  >
                    <TextArea
                      value={entry.highlights.join('\n')}
                      onChange={(value) =>
                        update({ ...entry, highlights: value.split('\n').filter((line) => line.trim()) })
                      }
                      rows={4}
                    />
                  </Field>
                </div>
              </div>
            )}
          />
        )}

        {tab === 'education' && (
          <ListEditor<EducationEntry>
            title="Education"
            icon="building"
            items={draft.education}
            onChange={(items) => set('education', items)}
            blank={{ degree: '', institution: '', location: '', start: '', end: '' }}
            summarise={(entry) => `${entry.degree || 'Qualification'}${entry.institution ? ` — ${entry.institution}` : ''}`}
            render={(entry, update) => (
              <div className="grid g-2" style={{ gap: 12 }}>
                <Field label="Qualification">
                  <TextInput value={entry.degree} onChange={(value) => update({ ...entry, degree: value })} />
                </Field>
                <Field label="Institution">
                  <TextInput value={entry.institution} onChange={(value) => update({ ...entry, institution: value })} />
                </Field>
                <Field label="From">
                  <TextInput value={entry.start} onChange={(value) => update({ ...entry, start: value })} />
                </Field>
                <Field label="To">
                  <TextInput value={entry.end} onChange={(value) => update({ ...entry, end: value })} />
                </Field>
              </div>
            )}
          />
        )}

        {tab === 'skills' && (
          <Card>
            <CardHead
              title="Skills and technologies"
              icon="layers"
              subtitle="A CV may name only what appears here"
            />
            <div className="card-body col" style={{ gap: 18 }}>
              <Field
                label="Technologies"
                hint="Languages, frameworks and tools. The match score is built mostly from this list."
              >
                <TagInput values={draft.technologies} onChange={(values) => set('technologies', values)} />
              </Field>
              <Field label="Other skills" hint="Practices and strengths that are not a technology.">
                <TagInput values={draft.skills} onChange={(values) => set('skills', values)} />
              </Field>
              <Field label="Achievements" hint="Used only where they are true and relevant.">
                <TagInput values={draft.achievements} onChange={(values) => set('achievements', values)} />
              </Field>
            </div>
          </Card>
        )}

        {tab === 'targets' && (
          <div className="grid g-2" style={{ gap: 16 }}>
            <Card>
              <CardHead title="What you are looking for" icon="target" />
              <div className="card-body col" style={{ gap: 16 }}>
                <Field label="Target roles" hint="Drives both discovery and the role dimension of the score.">
                  <TagInput values={draft.target_roles} onChange={(values) => set('target_roles', values)} />
                </Field>
                <Field label="Target locations">
                  <TagInput values={draft.target_locations} onChange={(values) => set('target_locations', values)} />
                </Field>
                <Field label="Target countries">
                  <TagInput values={draft.target_countries} onChange={(values) => set('target_countries', values)} />
                </Field>
                <Field label="Seniority you are targeting">
                  <TagInput
                    values={draft.seniority_targets}
                    onChange={(values) => set('seniority_targets', values)}
                    placeholder="junior, mid, senior, lead"
                  />
                </Field>
                <Field label="Minimum salary">
                  <TextInput
                    type="number"
                    value={draft.min_salary ? String(draft.min_salary) : ''}
                    onChange={(value) => set('min_salary', value ? Number(value) : null)}
                  />
                </Field>
              </div>
            </Card>

            <div className="col" style={{ gap: 16 }}>
              <Card>
                <CardHead title="Working arrangement" icon="pin" />
                <div className="card-body col" style={{ gap: 0 }}>
                  <Switch
                    checked={draft.remote_only}
                    onChange={(value) => set('remote_only', value)}
                    label="Remote only"
                    hint="A non-remote posting scores zero on location when this is on."
                  />
                  <Switch
                    checked={draft.accepts_hybrid}
                    onChange={(value) => set('accepts_hybrid', value)}
                    label="Open to hybrid"
                  />
                  <Switch
                    checked={draft.accepts_onsite}
                    onChange={(value) => set('accepts_onsite', value)}
                    label="Open to on site"
                  />
                  <Switch
                    checked={draft.willing_to_relocate}
                    onChange={(value) => set('willing_to_relocate', value)}
                    label="Willing to relocate"
                    hint="Softens the penalty on a location outside your targets."
                  />
                </div>
              </Card>

              <Card>
                <CardHead title="Exclusions" icon="close" />
                <div className="card-body col" style={{ gap: 14 }}>
                  <Field label="Companies">
                    <TagInput
                      values={draft.excluded_companies}
                      onChange={(values) => set('excluded_companies', values)}
                    />
                  </Field>
                  <Field label="Keywords">
                    <TagInput
                      values={draft.excluded_keywords}
                      onChange={(values) => set('excluded_keywords', values)}
                    />
                  </Field>
                  <Field label="Industries">
                    <TagInput
                      values={draft.excluded_industries}
                      onChange={(values) => set('excluded_industries', values)}
                    />
                  </Field>
                </div>
              </Card>
            </div>
          </div>
        )}

        {tab === 'extras' && (
          <div className="col" style={{ gap: 16 }}>
            <ListEditor<ProjectEntry>
              title="Projects"
              icon="layers"
              items={draft.projects}
              onChange={(items) => set('projects', items)}
              blank={{ name: '', description: '', url: '', technologies: [] }}
              summarise={(entry) => entry.name || 'Untitled project'}
              render={(entry, update) => (
                <div className="col" style={{ gap: 12 }}>
                  <div className="grid g-2" style={{ gap: 12 }}>
                    <Field label="Name">
                      <TextInput value={entry.name} onChange={(value) => update({ ...entry, name: value })} />
                    </Field>
                    <Field label="Link">
                      <TextInput value={entry.url} onChange={(value) => update({ ...entry, url: value })} />
                    </Field>
                  </div>
                  <Field label="Description">
                    <TextArea
                      value={entry.description}
                      onChange={(value) => update({ ...entry, description: value })}
                      rows={3}
                    />
                  </Field>
                  <Field label="Technologies">
                    <TagInput
                      values={entry.technologies}
                      onChange={(values) => update({ ...entry, technologies: values })}
                    />
                  </Field>
                </div>
              )}
            />

            <ListEditor<CertificationEntry>
              title="Certifications"
              icon="shield"
              items={draft.certifications}
              onChange={(items) => set('certifications', items)}
              blank={{ name: '', issuer: '', year: '' }}
              summarise={(entry) => entry.name || 'Certification'}
              render={(entry, update) => (
                <div className="grid g-3" style={{ gap: 12 }}>
                  <Field label="Name">
                    <TextInput value={entry.name} onChange={(value) => update({ ...entry, name: value })} />
                  </Field>
                  <Field label="Issuer">
                    <TextInput value={entry.issuer} onChange={(value) => update({ ...entry, issuer: value })} />
                  </Field>
                  <Field label="Year">
                    <TextInput value={entry.year} onChange={(value) => update({ ...entry, year: value })} />
                  </Field>
                </div>
              )}
            />

            <ListEditor<LanguageEntry>
              title="Languages"
              icon="users"
              items={draft.languages}
              onChange={(items) => set('languages', items)}
              blank={{ name: '', level: '' }}
              summarise={(entry) => `${entry.name || 'Language'}${entry.level ? ` — ${entry.level}` : ''}`}
              render={(entry, update) => (
                <div className="grid g-2" style={{ gap: 12 }}>
                  <Field label="Language">
                    <TextInput value={entry.name} onChange={(value) => update({ ...entry, name: value })} />
                  </Field>
                  <Field label="Level">
                    <TextInput
                      value={entry.level}
                      onChange={(value) => update({ ...entry, level: value })}
                      placeholder="Native, C1, B2"
                    />
                  </Field>
                </div>
              )}
            />
          </div>
        )}
      </div>

      {dirty && (
        <div
          className="row"
          style={{
            position: 'sticky',
            bottom: 0,
            marginTop: 20,
            padding: '12px 16px',
            background: 'var(--surface-2)',
            border: '1px solid var(--border-strong)',
            borderRadius: 'var(--r-md)',
            boxShadow: 'var(--shadow-raised)',
            gap: 12,
          }}
        >
          <Icon name="info" size={16} color="var(--status-warn)" />
          <span className="t-small" style={{ flex: 1 }}>
            You have unsaved changes.
          </span>
          <Button onClick={() => setDraft(state.data)}>Discard</Button>
          <Button variant="primary" icon="check" busy={saving} onClick={save}>
            Save changes
          </Button>
        </div>
      )}

      {importing && (
        <ImportModal
          onClose={() => setImporting(false)}
          onApply={(preview) => {
            setDraft((current) => (current ? { ...current, ...stripMeta(preview) } : current));
            setImporting(false);
            notify('Imported into the form. Review every field, then save.', 'warn');
          }}
        />
      )}
    </div>
  );
}

function stripMeta(preview: ImportPreview): Partial<Candidate> {
  const { method, source_text, warnings, ...rest } = preview;
  return rest as Partial<Candidate>;
}

function ListEditor<T>({
  title,
  icon,
  items,
  onChange,
  blank,
  render,
  summarise,
}: {
  title: string;
  icon: 'briefcase' | 'building' | 'layers' | 'shield' | 'users';
  items: T[];
  onChange: (items: T[]) => void;
  blank: T;
  render: (item: T, update: (next: T) => void) => JSX.Element;
  summarise: (item: T) => string;
}) {
  const [expanded, setExpanded] = useState<number | null>(items.length ? 0 : null);

  return (
    <Card>
      <CardHead
        title={title}
        icon={icon}
        action={
          <Button
            size="sm"
            icon="plus"
            onClick={() => {
              onChange([...items, structuredClone(blank)]);
              setExpanded(items.length);
            }}
          >
            Add
          </Button>
        }
      />
      <div className="card-body col" style={{ gap: 8 }}>
        {items.length === 0 ? (
          <p className="t-small muted">Nothing added yet.</p>
        ) : (
          items.map((item, index) => (
            <div
              key={index}
              style={{
                border: '1px solid var(--border)',
                borderRadius: 'var(--r-md)',
                background: 'var(--surface-2)',
                overflow: 'hidden',
              }}
            >
              <div className="row" style={{ gap: 8, padding: '10px 12px' }}>
                <button
                  className="row"
                  style={{ gap: 8, flex: 1, minWidth: 0, textAlign: 'left' }}
                  onClick={() => setExpanded(expanded === index ? null : index)}
                >
                  <Icon
                    name={expanded === index ? 'chevronDown' : 'chevronRight'}
                    size={14}
                    color="var(--text-muted)"
                  />
                  <span className="t-small truncate">{summarise(item)}</span>
                </button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon="trash"
                  title="Remove"
                  onClick={() => {
                    onChange(items.filter((_, position) => position !== index));
                    setExpanded(null);
                  }}
                />
              </div>
              {expanded === index && (
                <div style={{ padding: '4px 12px 14px', borderTop: '1px solid var(--border)' }}>
                  {render(item, (next) =>
                    onChange(items.map((entry, position) => (position === index ? next : entry))),
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

function ImportModal({
  onClose,
  onApply,
}: {
  onClose: () => void;
  onApply: (preview: ImportPreview) => void;
}) {
  const { notify } = useApp();
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const run = async (action: () => Promise<ImportPreview>) => {
    setBusy(true);
    try {
      setPreview(await action());
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Import a CV"
      subtitle="Extracted fields are shown for you to review before anything is saved"
      onClose={onClose}
      wide
      footer={
        <>
          <span className="t-caption muted" style={{ flex: 1 }}>
            Nothing is written to your profile until you save the form afterwards.
          </span>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            icon="check"
            disabled={!preview}
            onClick={() => preview && onApply(preview)}
          >
            Use these fields
          </Button>
        </>
      }
    >
      {!preview ? (
        <div className="col" style={{ gap: 18 }}>
          <div className="col" style={{ gap: 8 }}>
            <span className="label">Upload a file</span>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.docx,.txt,.md"
              style={{ display: 'none' }}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) run(() => api.profile.importFile(file));
              }}
            />
            <Button icon="upload" busy={busy} onClick={() => fileRef.current?.click()}>
              Choose a PDF, DOCX or text file
            </Button>
            <span className="t-caption muted">
              A scanned PDF has no text layer and cannot be read. Export a text-based PDF, or paste
              the text below.
            </span>
          </div>

          <div className="col" style={{ gap: 8 }}>
            <span className="label">Or paste the text</span>
            <TextArea value={text} onChange={setText} rows={10} placeholder="Paste your CV here" />
            <Button
              variant="primary"
              icon="sparkle"
              busy={busy}
              disabled={!text.trim()}
              onClick={() => run(() => api.profile.importText(text))}
              style={{ alignSelf: 'flex-start' }}
            >
              Extract fields
            </Button>
          </div>
        </div>
      ) : (
        <div className="col" style={{ gap: 16 }}>
          <Notice tone="warn">
            <strong style={{ fontWeight: 600 }}>Check every field.</strong> Extraction is automatic
            and can get a date or an employer wrong. What you confirm here becomes the only thing your
            CV is allowed to claim.
          </Notice>
          {preview.warnings.map((warning) => (
            <Notice key={warning} tone="info">
              {warning}
            </Notice>
          ))}

          <div className="grid g-2" style={{ gap: 10 }}>
            <Extracted label="Name" value={preview.full_name} />
            <Extracted label="Email" value={preview.email} />
            <Extracted label="Phone" value={preview.phone} />
            <Extracted label="Location" value={preview.location} />
            <Extracted label="Headline" value={preview.headline} />
            <Extracted label="Current role" value={preview.current_role} />
          </div>

          <Extracted label="Summary" value={preview.summary} block />

          <div className="col" style={{ gap: 6 }}>
            <span className="t-overline muted">Experience ({preview.experience?.length ?? 0})</span>
            {(preview.experience ?? []).map((entry, index) => (
              <div
                key={index}
                className="row"
                style={{ gap: 8, padding: '8px 10px', background: 'var(--surface-2)', borderRadius: 'var(--r-sm)' }}
              >
                <span className="t-small" style={{ flex: 1 }}>
                  {entry.title} — {entry.company}
                </span>
                <span className="t-caption muted mono">
                  {entry.start} – {entry.end || 'Present'}
                </span>
              </div>
            ))}
            {!(preview.experience ?? []).length && (
              <p className="t-caption muted">None found. You will need to add these by hand.</p>
            )}
          </div>

          <div className="col" style={{ gap: 6 }}>
            <span className="t-overline muted">Technologies detected</span>
            <div className="chip-group">
              {(preview.technologies ?? []).map((tech) => (
                <span key={tech} className="chip on">
                  {tech}
                </span>
              ))}
              {!(preview.technologies ?? []).length && (
                <span className="t-caption muted">None detected.</span>
              )}
            </div>
          </div>

          <Button icon="chevronLeft" onClick={() => setPreview(null)} style={{ alignSelf: 'flex-start' }}>
            Try a different file
          </Button>
        </div>
      )}
    </Modal>
  );
}

function Extracted({ label, value, block }: { label: string; value?: string; block?: boolean }) {
  return (
    <div className="col" style={{ gap: 3, gridColumn: block ? 'span 2' : undefined }}>
      <span className="t-caption muted">{label}</span>
      <span className={`t-small ${value ? '' : 'muted'}`}>{value || 'Not found'}</span>
    </div>
  );
}
