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
