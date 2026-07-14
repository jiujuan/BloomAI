import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

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
