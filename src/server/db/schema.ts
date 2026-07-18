import { desc } from 'drizzle-orm'
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const personas = sqliteTable('personas', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  system_prompt: text('system_prompt').notNull(),
  model_override: text('model_override'),
  is_builtin: integer('is_builtin').notNull().default(0),
  created_at: integer('created_at').notNull(),
})

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  title: text('title').notNull().default('New Chat'),
  persona_id: text('persona_id'),
  model: text('model').notNull().default('claude-3-5-sonnet-20241022'),
  status: text('status').notNull().default('active'),
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
})

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  session_id: text('session_id').notNull(),
  role: text('role').notNull(),
  content: text('content').notNull(),
  tool_calls: text('tool_calls'),
  parts: text('parts'),
  tokens: integer('tokens'),
  created_at: integer('created_at').notNull(),
}, (table) => ({
  sessionIdx: index('idx_messages_session').on(table.session_id, table.created_at),
}))

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updated_at: integer('updated_at').notNull(),
})

export const llm_providers = sqliteTable('llm_providers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  base_url: text('base_url'),
  api_key_setting_key: text('api_key_setting_key'),
  is_enabled: integer('is_enabled').notNull().default(1),
  config_json: text('config_json').notNull().default('{}'),
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
})

export const llm_models = sqliteTable('llm_models', {
  id: text('id').primaryKey(),
  provider_id: text('provider_id').notNull(),
  model_id: text('model_id').notNull(),
  label: text('label').notNull(),
  modality: text('modality').notNull(),
  capabilities_json: text('capabilities_json').notNull().default('{}'),
  is_enabled: integer('is_enabled').notNull().default(1),
  is_builtin: integer('is_builtin').notNull().default(1),
  sort_order: integer('sort_order').notNull().default(0),
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
})

export const llm_video_tasks = sqliteTable('llm_video_tasks', {
  id: text('id').primaryKey(),
  provider_id: text('provider_id').notNull(),
  model: text('model').notNull(),
  provider_task_id: text('provider_task_id'),
  provider_video_id: text('provider_video_id'),
  input_json: text('input_json').notNull(),
  output_json: text('output_json'),
  status: text('status').notNull(),
  progress: integer('progress'),
  error_msg: text('error_msg'),
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
})

export const tools = sqliteTable('tools', {
  id: text('id').primaryKey(),
  category: text('category').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  params_schema: text('params_schema').notNull().default('{}'),
  result_schema: text('result_schema').notNull().default('{}'),
  is_builtin: integer('is_builtin').default(1),
  is_enabled: integer('is_enabled').default(1),
  requires_permission: text('requires_permission'),
  created_at: integer('created_at').notNull(),
})

export const tool_runs = sqliteTable('tool_runs', {
  id: text('id').primaryKey(),
  tool_id: text('tool_id').notNull(),
  session_id: text('session_id'),
  input_json: text('input_json').notNull(),
  output_json: text('output_json'),
  status: text('status').notNull(),
  error_msg: text('error_msg'),
  duration_ms: integer('duration_ms'),
  started_at: integer('started_at').notNull(),
  finished_at: integer('finished_at'),
})

export const tool_permissions = sqliteTable('tool_permissions', {
  id: text('id').primaryKey(),
  tool_id: text('tool_id').notNull(),
  granted: integer('granted').default(0),
  granted_at: integer('granted_at'),
  scope: text('scope').default('session'),
})

export const skills = sqliteTable('skills', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  type: text('type').notNull(),
  source: text('source').notNull(),
  params_schema: text('params_schema').notNull().default('{}'),
  author: text('author'),
  version: text('version').default('1.0.0'),
  is_public: integer('is_public').default(0),
  is_installed: integer('is_installed').default(1),
  install_count: integer('install_count').default(0),
  created_at: integer('created_at').notNull(),
})

export const skill_runs = sqliteTable('skill_runs', {
  id: text('id').primaryKey(),
  skill_id: text('skill_id').notNull(),
  input_json: text('input_json').notNull(),
  output_json: text('output_json'),
  status: text('status').notNull(),
  duration_ms: integer('duration_ms'),
  created_at: integer('created_at').notNull(),
})

export const schema_migrations = sqliteTable('schema_migrations', {
  version: text('version').primaryKey(),
  applied_at: integer('applied_at').notNull(),
})

export const skill_packages = sqliteTable('skill_packages', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  source_type: text('source_type').notNull(),
  source_uri: text('source_uri'),
  source_ref: text('source_ref'),
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
})

export const skill_versions = sqliteTable('skill_versions', {
  id: text('id').primaryKey(),
  package_id: text('package_id').notNull(),
  version: text('version').notNull(),
  runtime: text('runtime').notNull().default('instruction-agent'),
  manifest_json: text('manifest_json').notNull(),
  manifest_hash: text('manifest_hash').notNull(),
  package_path: text('package_path').notNull(),
  source_snapshot_json: text('source_snapshot_json').notNull().default('{}'),
  is_compatible: integer('is_compatible').notNull().default(1),
  created_at: integer('created_at').notNull(),
}, (table) => ({
  packageIdx: index('idx_skill_versions_package').on(table.package_id),
}))

export const skill_installations = sqliteTable('skill_installations', {
  id: text('id').primaryKey(),
  package_id: text('package_id').notNull(),
  current_version_id: text('current_version_id').notNull(),
  status: text('status').notNull(),
  enabled: integer('enabled').notNull().default(1),
  installed_at: integer('installed_at').notNull(),
  updated_at: integer('updated_at').notNull(),
}, (table) => ({
  packageIdx: index('idx_skill_installations_package').on(table.package_id),
}))

export const skill_runs_v2 = sqliteTable('skill_runs_v2', {
  id: text('id').primaryKey(),
  skill_version_id: text('skill_version_id').notNull(),
  status: text('status').notNull(),
  revision: integer('revision').notNull().default(0),
  input_json: text('input_json').notNull().default('{}'),
  output_json: text('output_json'),
  context_json: text('context_json').notNull().default('{}'),
  surface: text('surface'),
  session_id: text('session_id'),
  image_session_id: text('image_session_id'),
  waiting_reason: text('waiting_reason'),
  cancel_requested: integer('cancel_requested').notNull().default(0),
  started_at: integer('started_at'),
  updated_at: integer('updated_at').notNull(),
  finished_at: integer('finished_at'),
  error_code: text('error_code'),
  error_message: text('error_message'),
}, (table) => ({
  versionIdx: index('idx_skill_runs_v2_version').on(table.skill_version_id),
}))

export const skill_run_events = sqliteTable('skill_run_events', {
  id: text('id').primaryKey(),
  run_id: text('run_id').notNull(),
  seq: integer('seq').notNull(),
  schema_version: integer('schema_version').notNull().default(1),
  type: text('type').notNull(),
  payload_json: text('payload_json').notNull().default('{}'),
  created_at: integer('created_at').notNull(),
}, (table) => ({
  runSeqIdx: index('idx_skill_run_events_run_seq').on(table.run_id, table.seq),
}))

export const skill_run_commands = sqliteTable('skill_run_commands', {
  id: text('id').primaryKey(),
  run_id: text('run_id').notNull(),
  idempotency_key: text('idempotency_key').notNull(),
  result_json: text('result_json').notNull(),
  created_at: integer('created_at').notNull(),
}, (table) => ({
  runIdx: index('idx_skill_run_commands_run').on(table.run_id, table.created_at),
}))

export const skill_artifacts = sqliteTable('skill_artifacts', {
  id: text('id').primaryKey(),
  run_id: text('run_id').notNull(),
  kind: text('kind').notNull(),
  mime_type: text('mime_type'),
  path: text('path').notNull(),
  size_bytes: integer('size_bytes').notNull().default(0),
  sha256: text('sha256').notNull(),
  metadata_json: text('metadata_json').notNull().default('{}'),
  created_at: integer('created_at').notNull(),
}, (table) => ({
  runIdx: index('idx_skill_artifacts_run').on(table.run_id),
}))

export const skill_capability_grants = sqliteTable('skill_capability_grants', {
  id: text('id').primaryKey(),
  skill_version_id: text('skill_version_id').notNull(),
  capability: text('capability').notNull(),
  grant_mode: text('grant_mode').notNull(),
  scope_json: text('scope_json').notNull().default('{}'),
  granted_by: text('granted_by'),
  granted_at: integer('granted_at').notNull(),
  expires_at: integer('expires_at'),
  revoked_at: integer('revoked_at'),
  session_id: text('session_id'),
  consumed_at: integer('consumed_at'),
}, (table) => ({
  versionIdx: index('idx_skill_capability_grants_version').on(table.skill_version_id),
}))

// AI 画图 (Image Studio) — independent feature. Sessions are decoupled from chat `sessions`
// (Plan A); the conversation itself reuses the `messages` table (session_id points here).
export const image_sessions = sqliteTable('image_sessions', {
  id: text('id').primaryKey(),
  title: text('title').notNull().default('新画图'),
  default_model: text('default_model'),
  status: text('status').notNull().default('active'),
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
})

export const image_generations = sqliteTable('image_generations', {
  id: text('id').primaryKey(),
  session_id: text('session_id').notNull(),
  message_id: text('message_id'),
  prompt: text('prompt').notNull(),
  resolved_prompt: text('resolved_prompt'),
  provider_id: text('provider_id').notNull(),
  model: text('model').notNull(),
  aspect_ratio: text('aspect_ratio'),
  style: text('style'),
  size: text('size'),
  seed: integer('seed'),
  reference_images: text('reference_images'),
  status: text('status').notNull(),
  provider_task_id: text('provider_task_id'),
  progress: integer('progress'),
  url: text('url'),
  local_path: text('local_path'),
  error_msg: text('error_msg'),
  duration_ms: integer('duration_ms'),
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
}, (table) => ({
  sessionIdx: index('idx_image_gen_session').on(table.session_id, table.created_at),
}))

export type Setting = typeof settings.$inferSelect
export type NewSetting = typeof settings.$inferInsert

export const article_illustration_jobs = sqliteTable('article_illustration_jobs', {
  id: text('id').primaryKey(),
  source_type: text('source_type').notNull(),
  source_label: text('source_label').notNull(),
  source_url: text('source_url'),
  article_text: text('article_text').notNull(),
  mode: text('mode').notNull(),
  skill_version_id: text('skill_version_id'),
  run_id: text('run_id'),
  image_session_id: text('image_session_id'),
  config_json: text('config_json').notNull().default('{}'),
  status: text('status').notNull().default('waiting_approval'),
  error_message: text('error_message'),
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
}, (table) => ({
  statusUpdatedIdx: index('idx_article_illustration_jobs_status_updated').on(table.status, table.updated_at),
}))

export const article_illustration_scenes = sqliteTable('article_illustration_scenes', {
  id: text('id').primaryKey(),
  job_id: text('job_id').notNull(),
  ordinal: integer('ordinal').notNull(),
  title: text('title').notNull(),
  excerpt: text('excerpt').notNull().default(''),
  prompt: text('prompt').notNull(),
  status: text('status').notNull().default('planned'),
  generation_id: text('generation_id'),
  error_message: text('error_message'),
  retry_count: integer('retry_count').notNull().default(0),
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
}, (table) => ({
  jobOrdinalIdx: index('idx_article_illustration_scenes_job_ordinal').on(table.job_id, table.ordinal),
}))


export const research_runs = sqliteTable('research_runs', {
  id: text('id').primaryKey(),
  session_id: text('session_id'),
  topic: text('topic').notNull(),
  profile: text('profile').notNull(),
  depth: text('depth').notNull(),
  status: text('status').notNull(),
  phase: text('phase').notNull(),
  progress: real('progress').notNull().default(0),
  input_json: text('input_json').notNull(),
  brief_json: text('brief_json'),
  budget_json: text('budget_json').notNull(),
  usage_json: text('usage_json').notNull().default('{}'),
  quality_json: text('quality_json'),
  workflow_run_id: text('workflow_run_id'),
  report_artifact_id: text('report_artifact_id'),
  resume_phase: text('resume_phase'),
  executor_id: text('executor_id'),
  lease_expires_at: integer('lease_expires_at'),
  heartbeat_at: integer('heartbeat_at'),
  error_code: text('error_code'),
  error_message: text('error_message'),
  error_retryable: integer('error_retryable'),
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
  completed_at: integer('completed_at'),
  state_version: integer('state_version').notNull().default(0),
  current_attempt_id: text('current_attempt_id'),
  cancel_requested_at: integer('cancel_requested_at'),
  cancel_reason: text('cancel_reason'),
  stop_reason_json: text('stop_reason_json'),
  limitations_json: text('limitations_json').notNull().default('[]'),
  workflow_version: text('workflow_version'),
  coverage_policy_version: text('coverage_policy_version'),
  parser_version: text('parser_version'),
  model_contract_version: text('model_contract_version'),
  model_selection_snapshot_json: text('model_selection_snapshot_json'),
  last_checkpoint_sequence: integer('last_checkpoint_sequence'),
}, (table) => ({
  statusUpdatedIdx: index('idx_research_runs_status_updated').on(table.status, table.updated_at),
  currentAttemptIdx: index('idx_research_runs_current_attempt').on(table.current_attempt_id),
  cancellationIdx: index('idx_research_runs_cancellation').on(table.cancel_requested_at),
}))

export const research_run_attempts = sqliteTable('research_run_attempts', {
  id: text('id').primaryKey(),
  run_id: text('run_id').notNull(),
  ordinal: integer('ordinal').notNull(),
  trigger: text('trigger').notNull(),
  status: text('status').notNull().default('queued'),
  workflow_run_id: text('workflow_run_id'),
  executor_id: text('executor_id'),
  ownership_token: text('ownership_token'),
  lease_expires_at: integer('lease_expires_at'),
  heartbeat_at: integer('heartbeat_at'),
  start_checkpoint_key: text('start_checkpoint_key'),
  end_checkpoint_key: text('end_checkpoint_key'),
  error_code: text('error_code'),
  error_category: text('error_category'),
  error_message: text('error_message'),
  error_retryable: integer('error_retryable'),
  model_usage_json: text('model_usage_json').notNull().default('{}'),
  model_trace_json: text('model_trace_json').notNull().default('[]'),
  started_at: integer('started_at'),
  ended_at: integer('ended_at'),
  created_at: integer('created_at').notNull(),
}, (table) => ({
  runOrdinalIdx: uniqueIndex('idx_research_run_attempts_run_ordinal').on(table.run_id, table.ordinal),
  runStatusIdx: index('idx_research_run_attempts_run_status').on(table.run_id, table.status, table.created_at),
  leaseIdx: index('idx_research_run_attempts_lease').on(table.lease_expires_at),
  ownershipTokenIdx: index('idx_research_run_attempts_ownership_token').on(table.ownership_token),
}))

export const research_run_checkpoints = sqliteTable('research_run_checkpoints', {
  id: text('id').primaryKey(),
  run_id: text('run_id').notNull(),
  attempt_id: text('attempt_id').notNull(),
  sequence: integer('sequence').notNull(),
  checkpoint_key: text('checkpoint_key').notNull(),
  phase: text('phase').notNull(),
  status: text('status').notNull().default('started'),
  resume_cursor_json: text('resume_cursor_json').notNull().default('{}'),
  input_fingerprint: text('input_fingerprint').notNull(),
  output_fingerprint: text('output_fingerprint'),
  replay_policy: text('replay_policy').notNull().default('reuse'),
  created_at: integer('created_at').notNull(),
}, (table) => ({
  attemptSequenceIdx: uniqueIndex('idx_research_run_checkpoints_attempt_sequence').on(table.attempt_id, table.sequence),
  runCheckpointInputIdx: uniqueIndex('idx_research_run_checkpoints_run_key_input').on(table.run_id, table.checkpoint_key, table.input_fingerprint),
  runSequenceIdx: index('idx_research_run_checkpoints_run_sequence').on(table.run_id, desc(table.sequence)),
  attemptStatusIdx: index('idx_research_run_checkpoints_attempt_status').on(table.attempt_id, table.status, desc(table.sequence)),
}))

export const research_iterations = sqliteTable('research_iterations', {
  id: text('id').primaryKey(),
  run_id: text('run_id').notNull(),
  ordinal: integer('ordinal').notNull(),
  status: text('status').notNull().default('planned'),
  decision: text('decision'),
  target_question_ids_json: text('target_question_ids_json').notNull().default('[]'),
  coverage_before_json: text('coverage_before_json').notNull().default('{}'),
  coverage_after_json: text('coverage_after_json').notNull().default('{}'),
  plan_json: text('plan_json').notNull().default('{}'),
  planned_query_count: integer('planned_query_count').notNull().default(0),
  executed_query_count: integer('executed_query_count').notNull().default(0),
  new_source_count: integer('new_source_count').notNull().default(0),
  new_evidence_count: integer('new_evidence_count').notNull().default(0),
  budget_before_json: text('budget_before_json').notNull().default('{}'),
  budget_after_json: text('budget_after_json').notNull().default('{}'),
  stop_reason_json: text('stop_reason_json'),
  limitations_json: text('limitations_json').notNull().default('[]'),
  created_at: integer('created_at').notNull(),
  completed_at: integer('completed_at'),
}, (table) => ({
  runOrdinalIdx: uniqueIndex('idx_research_iterations_run_ordinal').on(table.run_id, table.ordinal),
  runStatusIdx: index('idx_research_iterations_run_status').on(table.run_id, table.status, table.ordinal),
}))

export const research_coverage_assessments = sqliteTable('research_coverage_assessments', {
  id: text('id').primaryKey(),
  run_id: text('run_id').notNull(),
  attempt_id: text('attempt_id'),
  iteration_id: text('iteration_id'),
  iteration_ordinal: integer('iteration_ordinal').notNull().default(0),
  policy_version: text('policy_version').notNull(),
  input_fingerprint: text('input_fingerprint').notNull(),
  aggregate_score: real('aggregate_score').notNull().default(0),
  question_verdicts_json: text('question_verdicts_json').notNull().default('[]'),
  assessment_v2_json: text('assessment_v2_json').notNull().default('[]'),
  coverage_projections_json: text('coverage_projections_json').notNull().default('[]'),
  limitations_json: text('limitations_json').notNull().default('[]'),
  created_at: integer('created_at').notNull(),
}, (table) => ({
  runIterationPolicyInputIdx: uniqueIndex('idx_research_coverage_assessments_run_iteration_policy_input').on(table.run_id, table.iteration_ordinal, table.policy_version, table.input_fingerprint),
  runIterationIdx: index('idx_research_coverage_assessments_run_iteration').on(table.run_id, table.iteration_ordinal, desc(table.created_at)),
}))


export const research_questions = sqliteTable('research_questions', {
  id: text('id').primaryKey(),
  run_id: text('run_id').notNull(),
  parent_question_id: text('parent_question_id'),
  ordinal: integer('ordinal').notNull(),
  question: text('question').notNull(),
  intent: text('intent').notNull(),
  required_evidence_types_json: text('required_evidence_types_json').notNull().default('[]'),
  section_key: text('section_key'),
  question_type: text('question_type'),
  need_primary_source: integer('need_primary_source').notNull().default(0),
  need_recent_source: integer('need_recent_source').notNull().default(0),
  need_quantitative_evidence: integer('need_quantitative_evidence').notNull().default(0),
  source_targets_json: text('source_targets_json').notNull().default('[]'),
  priority: text('priority').notNull(),
  status: text('status').notNull(),
  coverage_json: text('coverage_json'),
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
}, (table) => ({
  runParentOrdinalIdx: index('idx_research_questions_run_parent_ordinal').on(table.run_id, table.parent_question_id, table.ordinal),
  runSectionOrdinalIdx: index('idx_research_questions_run_section_ordinal').on(table.run_id, table.section_key, table.ordinal),
}))

export const research_search_queries = sqliteTable('research_search_queries', {
  id: text('id').primaryKey(),
  run_id: text('run_id').notNull(),
  question_id: text('question_id').notNull(),
  iteration: integer('iteration').notNull(),
  query: text('query').notNull(),
  provider: text('provider'),
  status: text('status').notNull(),
  result_count: integer('result_count').notNull().default(0),
  error_code: text('error_code'),
  error_message: text('error_message'),
  error_retryable: integer('error_retryable'),
  idempotency_key: text('idempotency_key').notNull(),
  created_at: integer('created_at').notNull(),
  completed_at: integer('completed_at'),
  result_json: text('result_json').notNull().default('[]'),
}, (table) => ({
  runStatusIdx: index('idx_research_search_queries_run_status').on(table.run_id, table.status),
  runIdempotencyIdx: uniqueIndex('idx_research_search_queries_run_idempotency').on(table.run_id, table.idempotency_key),
}))

export const research_sources = sqliteTable('research_sources', {
  id: text('id').primaryKey(),
  run_id: text('run_id').notNull(),
  canonical_url: text('canonical_url').notNull(),
  original_url: text('original_url').notNull().default(''),
  domain: text('domain').notNull(),
  title: text('title'),
  author: text('author'),
  publisher: text('publisher'),
  published_at: integer('published_at'),
  source_type: text('source_type').notNull(),
  selection_status: text('selection_status').notNull(),
  scores_json: text('scores_json').notNull().default('{}'),
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
}, (table) => ({
  runSelectionIdx: index('idx_research_sources_run_selection').on(table.run_id, table.selection_status),
  runCanonicalUrlIdx: uniqueIndex('idx_research_sources_run_canonical_url').on(table.run_id, table.canonical_url),
}))

export const research_source_snapshots = sqliteTable('research_source_snapshots', {
  id: text('id').primaryKey(),
  run_id: text('run_id').notNull(),
  source_id: text('source_id').notNull(),
  content_hash: text('content_hash').notNull(),
  content: text('content').notNull(),
  metadata_json: text('metadata_json').notNull().default('{}'),
  fetched_at: integer('fetched_at').notNull(),
  parser_version: text('parser_version').notNull(),
  final_url: text('final_url').notNull(),
  http_status: integer('http_status'),
  idempotency_key: text('idempotency_key').notNull(),
  created_at: integer('created_at').notNull(),
}, (table) => ({
  runIdempotencyIdx: uniqueIndex('idx_research_source_snapshots_run_idempotency').on(table.run_id, table.idempotency_key),
}))

export const research_evidence = sqliteTable('research_evidence', {
  id: text('id').primaryKey(),
  run_id: text('run_id').notNull(),
  question_id: text('question_id').notNull(),
  snapshot_id: text('snapshot_id').notNull(),
  passage: text('passage').notNull(),
  summary: text('summary').notNull(),
  stance: text('stance').notNull(),
  confidence: real('confidence').notNull(),
  start_offset: integer('start_offset').notNull(),
  end_offset: integer('end_offset').notNull(),
  idempotency_key: text('idempotency_key').notNull(),
  created_at: integer('created_at').notNull(),
}, (table) => ({
  runQuestionIdx: index('idx_research_evidence_run_question').on(table.run_id, table.question_id),
  runIdempotencyIdx: uniqueIndex('idx_research_evidence_run_idempotency').on(table.run_id, table.idempotency_key),
}))

export const research_report_sections = sqliteTable('research_report_sections', {
  id: text('id').primaryKey(),
  run_id: text('run_id').notNull(),
  ordinal: integer('ordinal').notNull(),
  section_key: text('section_key'),
  title: text('title').notNull(),
  purpose: text('purpose').notNull(),
  draft: text('draft'),
  verified_text: text('verified_text'),
  status: text('status').notNull(),
  idempotency_key: text('idempotency_key').notNull(),
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
}, (table) => ({
  runOrdinalIdx: index('idx_research_report_sections_run_ordinal').on(table.run_id, table.ordinal),
  runSectionKeyIdx: uniqueIndex('idx_research_report_sections_run_section_key').on(table.run_id, table.section_key),
  runIdempotencyIdx: uniqueIndex('idx_research_report_sections_run_idempotency').on(table.run_id, table.idempotency_key),
}))

export const research_report_section_questions = sqliteTable('research_report_section_questions', {
  section_id: text('section_id').notNull(),
  question_id: text('question_id').notNull(),
  ordinal: integer('ordinal').notNull(),
  created_at: integer('created_at').notNull(),
}, (table) => ({
  sectionQuestionIdx: uniqueIndex('idx_research_report_section_questions_section_question').on(table.section_id, table.question_id),
  sectionOrdinalIdx: uniqueIndex('idx_research_report_section_questions_section_ordinal').on(table.section_id, table.ordinal),
  questionIdx: index('idx_research_report_section_questions_question').on(table.question_id),
}))

export const research_claims = sqliteTable('research_claims', {
  id: text('id').primaryKey(),
  run_id: text('run_id').notNull(),
  section_id: text('section_id').notNull(),
  text: text('text').notNull(),
  kind: text('kind').notNull(),
  importance: text('importance').notNull(),
  verification_status: text('verification_status').notNull(),
  confidence: real('confidence').notNull(),
  repair_history_json: text('repair_history_json').notNull().default('[]'),
  idempotency_key: text('idempotency_key').notNull(),
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
}, (table) => ({
  runSectionIdx: index('idx_research_claims_run_section').on(table.run_id, table.section_id),
  runIdempotencyIdx: uniqueIndex('idx_research_claims_run_idempotency').on(table.run_id, table.idempotency_key),
}))

export const research_citations = sqliteTable('research_citations', {
  id: text('id').primaryKey(),
  run_id: text('run_id').notNull(),
  claim_id: text('claim_id').notNull(),
  evidence_id: text('evidence_id').notNull(),
  entailment_status: text('entailment_status').notNull(),
  rationale: text('rationale').notNull(),
  ordinal: integer('ordinal').notNull(),
  created_at: integer('created_at').notNull(),
}, (table) => ({
  runOrdinalIdx: uniqueIndex('idx_research_citations_run_ordinal').on(table.run_id, table.ordinal),
}))

export const research_quality_assessments = sqliteTable('research_quality_assessments', {
  id: text('id').primaryKey(),
  run_id: text('run_id').notNull(),
  release_status: text('release_status').notNull(),
  high_priority_question_coverage: real('high_priority_question_coverage').notNull(),
  factual_claim_citation_coverage: real('factual_claim_citation_coverage').notNull(),
  supported_citation_coverage: real('supported_citation_coverage').notNull(),
  independent_cited_domain_count: integer('independent_cited_domain_count').notNull(),
  contradiction_disclosure_coverage: real('contradiction_disclosure_coverage').notNull(),
  required_section_coverage: real('required_section_coverage').notNull(),
  limitations_json: text('limitations_json').notNull().default('[]'),
  assessor_version: text('assessor_version').notNull(),
  created_at: integer('created_at').notNull(),
})

export const research_events = sqliteTable('research_events', {
  id: text('id').primaryKey(),
  run_id: text('run_id').notNull(),
  sequence: integer('sequence').notNull(),
  type: text('type').notNull(),
  phase: text('phase').notNull(),
  timestamp: integer('timestamp').notNull(),
  payload_json: text('payload_json').notNull().default('{}'),
}, (table) => ({
  runSequenceIdx: uniqueIndex('idx_research_events_run_sequence').on(table.run_id, table.sequence),
}))

export const research_recovery_commands = sqliteTable('research_recovery_commands', {
  id: text('id').primaryKey(),
  run_id: text('run_id').notNull(),
  command_key: text('command_key').notNull(),
  status: text('status').notNull().default('claimed'),
  dispatch_token: text('dispatch_token'),
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
}, (table) => ({
  runCommandKeyIdx: uniqueIndex('idx_research_recovery_commands_run_key').on(table.run_id, table.command_key),
}))

export const research_reconciliations = sqliteTable('research_reconciliations', {
  id: text('id').primaryKey(),
  run_id: text('run_id').notNull(),
  reconciliation_key: text('reconciliation_key').notNull(),
  checkpoint_key: text('checkpoint_key'),
  outcome_json: text('outcome_json').notNull().default('{}'),
  created_at: integer('created_at').notNull(),
}, (table) => ({
  runKeyIdx: uniqueIndex('idx_research_reconciliations_run_key').on(table.run_id, table.reconciliation_key),
  runCreatedIdx: index('idx_research_reconciliations_run_created').on(table.run_id, table.created_at),
}))

export const research_artifacts = sqliteTable('research_artifacts', {
  id: text('id').primaryKey(),
  run_id: text('run_id').notNull(),
  type: text('type').notNull(),
  file_name: text('file_name').notNull(),
  content_type: text('content_type').notNull(),
  storage_path: text('storage_path').notNull(),
  size_bytes: integer('size_bytes').notNull().default(0),
  content_hash: text('content_hash'),
  metadata_json: text('metadata_json').notNull().default('{}'),
  idempotency_key: text('idempotency_key').notNull(),
  created_at: integer('created_at').notNull(),
}, (table) => ({
  runTypeIdx: index('idx_research_artifacts_run_type').on(table.run_id, table.type),
  runIdempotencyIdx: uniqueIndex('idx_research_artifacts_run_idempotency').on(table.run_id, table.idempotency_key),
}))
