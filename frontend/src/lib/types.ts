/** Shapes mirroring the backend schemas. */

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface JobScore {
  id: number;
  score: number;
  confidence: number;
  recommendation: 'strong_apply' | 'apply' | 'maybe' | 'skip';
  breakdown: Record<string, number>;
  matched_skills: string[];
  missing_skills: string[];
  strengths: string[];
  gaps: string[];
  explanation: string;
  method: 'deterministic' | 'hybrid';
}

export interface Job {
  id: number;
  source: string;
  title: string;
  company: string;
  company_logo_url: string;
  location: string;
  city: string;
  country: string;
  remote_type: 'remote' | 'hybrid' | 'onsite' | 'unknown';
  seniority: string;
  employment_type: string;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string;
  technologies: string[];
  canonical_url: string;
  application_url: string;
  application_method: string;
  posted_at: string | null;
  discovered_at: string;
  stage: string;
  is_saved: boolean;
  is_excluded: boolean;
  duplicate_of_id: number | null;
  score: JobScore | null;
}

export interface JobDetail extends Job {
  description: string;
  requirements: string;
  responsibilities: string;
  benefits: string[];
  exclusion_reason: string;
  has_application: boolean;
  application_id: number | null;
  duplicate_count: number;
}

export interface DocumentSummary {
  id: number;
  kind: 'master_cv' | 'tailored_cv' | 'cover_letter';
  title: string;
  version: number;
  is_current: boolean;
  generated_by: string;
  model_name: string;
  truthfulness_passed: boolean;
  truthfulness_findings: string[];
  word_count: number;
  generation_seconds: number;
  created_at: string;
}

export interface DocumentDetail extends DocumentSummary {
  content: string;
  job_id: number | null;
}

export interface Application {
  id: number;
  job_id: number;
  stage: string;
  board_position: number;
  application_method: string;
  application_url: string;
  action_required_reason: string;
  submitted_at: string | null;
  responded_at: string | null;
  interview_at: string | null;
  follow_up_due: string | null;
  follow_up_count: number;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
  job: Job | null;
  has_cv: boolean;
  has_cover_letter: boolean;
}

export interface ApplicationDetail extends Application {
  job_snapshot: Record<string, unknown>;
  application_answers: { question: string; answer: string }[];
  recruiter_message: string;
  notes: string;
  stage_history: { stage: string; at: string; reason: string; actor: string }[];
  tailored_cv: DocumentDetail | null;
  cover_letter: DocumentDetail | null;
}

export interface BoardColumn {
  stage: string;
  count: number;
  items: Application[];
}

export interface Candidate {
  id: number;
  full_name: string;
  email: string;
  phone: string;
  location: string;
  country: string;
  headline: string;
  summary: string;
  linkedin_url: string;
  github_url: string;
  website_url: string;
  years_of_experience: number;
  current_role: string;
  experience: ExperienceEntry[];
  education: EducationEntry[];
  projects: ProjectEntry[];
  certifications: CertificationEntry[];
  languages: LanguageEntry[];
  skills: string[];
  technologies: string[];
  achievements: string[];
  target_roles: string[];
  target_locations: string[];
  target_countries: string[];
  remote_only: boolean;
  accepts_hybrid: boolean;
  accepts_onsite: boolean;
  willing_to_relocate: boolean;
  min_salary: number | null;
  salary_currency: string;
  seniority_targets: string[];
  excluded_companies: string[];
  excluded_keywords: string[];
  excluded_industries: string[];
  profile_version: number;
}

export interface ExperienceEntry {
  title: string;
  company: string;
  location: string;
  start: string;
  end: string;
  highlights: string[];
}

export interface EducationEntry {
  degree: string;
  institution: string;
  location: string;
  start: string;
  end: string;
}

export interface ProjectEntry {
  name: string;
  description: string;
  url: string;
  technologies: string[];
}

export interface CertificationEntry {
  name: string;
  issuer: string;
  year: string;
}

export interface LanguageEntry {
  name: string;
  level: string;
}

export interface Completeness {
  percent: number;
  missing: string[];
  ready_for_generation: boolean;
}

export interface ImportPreview extends Partial<Candidate> {
  method: string;
  source_text: string;
  warnings: string[];
}

export interface AutomationConfig {
  id: number;
  enabled: boolean;
  dry_run: boolean;
  emergency_stop: boolean;
  daily_application_limit: number;
  daily_discovery_limit: number;
  min_score: number;
  min_score_to_submit: number;
  enabled_sources: string[];
  greenhouse_boards: string[];
  lever_boards: string[];
  search_terms: string[];
  location_filters: string[];
  remote_only: boolean;
  min_salary: number | null;
  role_filters: string[];
  excluded_companies: string[];
  follow_up_after_days: number;
  schedule_cron: string;
}

export interface AutomationRun {
  id: number;
  status: string;
  trigger: string;
  dry_run: boolean;
  started_at: string | null;
  finished_at: string | null;
  current_stage: string;
  stages: Record<string, { status: string; count: number; note: string }>;
  jobs_discovered: number;
  jobs_deduplicated: number;
  jobs_scored: number;
  jobs_eligible: number;
  packages_prepared: number;
  applications_submitted: number;
  action_required: number;
  errors: string[];
  summary: string;
}

export interface AutomationState {
  is_running: boolean;
  is_paused: boolean;
  current_run: AutomationRun | null;
  config: AutomationConfig;
  blocking_reason: string | null;
}

export interface Activity {
  id: number;
  event: string;
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
  job_id: number | null;
  application_id: number | null;
  run_id: number | null;
  details: Record<string, unknown>;
  created_at: string;
}

export interface Rate {
  numerator: number;
  denominator: number;
  value: number;
  low_confidence: boolean;
}

export interface Overview {
  jobs_discovered: number;
  jobs_discovered_this_week: number;
  strong_matches: number;
  applications_prepared: number;
  applications_submitted: number;
  applications_submitted_this_week: number;
  interviews: number;
  offers: number;
  average_score: number;
  response_rate: Rate;
  interview_rate: Rate;
  offer_rate: Rate;
}

export interface Insight {
  level: 'info' | 'success' | 'warning';
  title: string;
  body: string;
  action: { label: string; view: string } | null;
}

export interface Dashboard {
  candidate: { full_name: string; headline: string; completeness: Completeness };
  overview: Overview;
  pipeline: { stage: string; count: number }[];
  daily: { date: string; jobs: number; applications: number }[];
  recent_matches: Job[];
  automation: {
    is_running: boolean;
    is_paused: boolean;
    enabled: boolean;
    dry_run: boolean;
    emergency_stop: boolean;
    last_run: AutomationRun | null;
  };
  activity: Activity[];
  insights: Insight[];
}

export interface SourceInfo {
  name: string;
  label: string;
  can_discover: boolean;
  can_submit: boolean;
  requires_credentials: boolean;
  note: string;
}

export interface Health {
  /** Always `job-hunter`. The desktop shell requires it to recognise its own backend. */
  service: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  database: { status: string; detail: string; tables?: number };
  llm: { status: string; provider: string; model: string; detail: string };
}

/** A file the backend reports on: where it is, whether it is there, how big. */
export interface FileFacts {
  path: string;
  exists: boolean;
  size_bytes: number;
}

/** One stage that calls the model, and the tag it will call. */
export interface ModelStage {
  stage: string;
  label: string;
  model: string;
  /** True when this stage is pinned to a tag of its own rather than running on
   *  the default. */
  pinned: boolean;
  /** `null` when the runtime did not answer: nothing can be claimed about a tag
   *  when the thing that would hold it is unreachable. */
  installed: boolean | null;
  pull_command: string;
}

export interface ModelStatus {
  provider: string;
  base_url: string;
  endpoint: string;
  reachable: boolean;
  detail: string;
  default_model: string;
  num_ctx: number;
  installed_models: string[];
  stages: ModelStage[];
  missing_models: string[];
  pull_commands: string[];
}

/** Everything the backend knows about where and how it is running. */
export interface SystemInfo {
  app_name: string;
  version: string;
  python: string;
  python_executable: string;
  platform: string;
  data_dir: string;
  port: number;
  database: FileFacts & { url: string };
  logs: FileFacts & { dir: string };
  llm: ModelStatus;
  llm_provider: string;
  llm_model: string;
  sources: SourceInfo[];
  jobs_stored: boolean;
}

export interface DiscoveryResponse {
  created: number;
  updated: number;
  duplicates: number;
  fetched: number;
  partial: boolean;
  sources: {
    source: string;
    ok: boolean;
    fetched: number;
    created: number;
    updated: number;
    duplicates: number;
    error: string;
  }[];
}

export interface Facets {
  sources: { value: string; count: number }[];
  companies: { value: string; count: number }[];
  remote_types: { value: string; count: number }[];
  seniorities: { value: string; count: number }[];
  countries: { value: string; count: number }[];
  technologies: { value: string; count: number }[];
}

export interface EmailTemplate {
  id: number;
  name: string;
  category: string;
  subject: string;
  body: string;
  variables: string[];
  is_builtin: boolean;
}

export interface EmailMessage {
  id: number;
  folder: string;
  status: string;
  subject: string;
  body: string;
  from_address: string;
  to_addresses: string[];
  classification: string;
  is_read: boolean;
  application_id: number | null;
  sent_at: string | null;
  received_at: string | null;
  created_at: string;
}

export interface EmailAccount {
  id: number;
  address: string;
  display_name: string;
  provider: string;
  smtp_host: string;
  smtp_port: number;
  is_connected: boolean;
  is_default: boolean;
  last_error: string;
  credential_ref: string;
}

export interface FollowUp {
  application_id: number;
  job_title: string;
  company: string;
  due: string;
  follow_up_count: number;
  suggested_subject: string;
  suggested_body: string;
}
