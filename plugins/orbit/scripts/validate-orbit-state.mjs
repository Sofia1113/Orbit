#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const repoRoot = path.resolve(root, '..', '..');
const stateDir = path.join(root, 'state');
const examplesDir = path.join(stateDir, 'examples');
const skillsDir = path.join(root, 'skills');

const readText = (file) => fs.readFileSync(file, 'utf8');
const readJson = (file) => JSON.parse(readText(file));
const schema = readJson(path.join(stateDir, 'runtime-state.schema.json'));
const rules = readJson(path.join(stateDir, 'rules.json'));
const taskPacketSchema = readJson(path.join(stateDir, 'task-packet.schema.json'));
const handoffSchema = readJson(path.join(stateDir, 'handoff.schema.json'));

const required = new Set(schema.required ?? []);
const stageValues = new Set(schema.properties.stage.enum);
const statusValues = new Set(schema.properties.status.enum);
const eventValues = new Set(schema.properties.last_event.enum);
const densityValues = new Set(schema.properties.density.enum);
const verificationValues = new Set(schema.properties.verification_level.enum);
const artifactKeys = schema.properties.artifacts.required;
const validTodoStatuses = new Set(schema.properties.todo.items.properties.status.enum);

const errors = [];
let activeErrors = errors;
const push = (file, message) => activeErrors.push(`${file}: ${message}`);

function requireText(file, text, expected) {
  if (!text.includes(expected)) push(file, `missing expected text: ${expected}`);
}

function validateSchemaBasics(file, data) {
  for (const key of ['$schema', '$id', 'title', 'type', 'required', 'properties']) {
    if (!(key in data)) push(file, `missing schema field ${key}`);
  }
  if (data.type !== 'object') push(file, 'schema type must be object');
  if (!Array.isArray(data.required)) push(file, 'schema required must be an array');
  if (!data.properties || typeof data.properties !== 'object' || Array.isArray(data.properties)) {
    push(file, 'schema properties must be an object');
  }
}

function validatePluginMetadata() {
  const plugin = readJson(path.join(root, '.claude-plugin', 'plugin.json'));
  const marketplace = readJson(path.join(repoRoot, '.claude-plugin', 'marketplace.json'));
  const marketplacePlugin = marketplace.plugins?.find((entry) => entry.name === plugin.name);

  if (!marketplacePlugin) push('marketplace.json', `missing plugin entry for ${plugin.name}`);
  if (marketplacePlugin && marketplacePlugin.version !== plugin.version) {
    push('marketplace.json', `version ${marketplacePlugin.version} must match plugin.json ${plugin.version}`);
  }
  if (marketplacePlugin && marketplacePlugin.source !== './plugins/orbit') {
    push('marketplace.json', `unexpected source ${marketplacePlugin.source}`);
  }
  if (plugin.skills !== './skills/') push('plugin.json', 'skills must point to ./skills/');
  if (plugin.agents !== './agents/') push('plugin.json', 'agents must point to ./agents/');
}

function validateRuntimeShape(file, data) {
  for (const key of required) {
    if (!(key in data)) push(file, `missing required field "${key}"`);
  }

  if (!densityValues.has(data.density)) push(file, `invalid density "${data.density}"`);
  if (!stageValues.has(data.stage)) push(file, `invalid stage "${data.stage}"`);
  if (!statusValues.has(data.status)) push(file, `invalid status "${data.status}"`);
  if (!eventValues.has(data.last_event)) push(file, `invalid last_event "${data.last_event}"`);
  if (!verificationValues.has(data.verification_level)) push(file, `invalid verification_level "${data.verification_level}"`);

  for (const field of ['task_id', 'goal', 'first_executor', 'current_owner', 'next_action']) {
    if (typeof data[field] !== 'string' || data[field].length === 0) {
      push(file, `field "${field}" must be a non-empty string`);
    }
  }

  const allowedTopLevel = new Set(Object.keys(schema.properties));
  for (const key of Object.keys(data)) {
    if (!allowedTopLevel.has(key)) push(file, `additional top-level field "${key}" is not allowed`);
  }

  if (!data.artifacts || typeof data.artifacts !== 'object' || Array.isArray(data.artifacts)) {
    push(file, 'artifacts must be an object');
  } else {
    for (const key of artifactKeys) {
      if (!(key in data.artifacts)) push(file, `missing artifacts.${key}`);
    }
    const allowedArtifactKeys = new Set(artifactKeys);
    for (const key of Object.keys(data.artifacts)) {
      if (!allowedArtifactKeys.has(key)) push(file, `additional artifacts.${key} is not allowed`);
      if (data.artifacts[key] !== null && typeof data.artifacts[key] !== 'string') {
        push(file, `artifacts.${key} must be string or null`);
      }
    }
  }

  if (data.triage_result !== undefined) {
    const triage = data.triage_result;
    for (const key of ['decision_path', 'density', 'rationale']) {
      if (!(key in triage)) push(file, `missing triage_result.${key}`);
    }
    if (!['Q1', 'Q2', 'Q3'].includes(triage.decision_path)) push(file, `invalid triage_result.decision_path "${triage.decision_path}"`);
    if (!densityValues.has(triage.density)) push(file, `invalid triage_result.density "${triage.density}"`);
  }

  const todos = Array.isArray(data.todo) ? data.todo : [];
  if (data.todo !== undefined && !Array.isArray(data.todo)) push(file, 'todo must be an array');
  const inProgressCount = todos.filter((todo) => todo.status === 'in_progress').length;
  if (inProgressCount > 1) push(file, 'todo must not contain more than one in_progress item');
  for (const [index, todo] of todos.entries()) {
    for (const key of ['id', 'text', 'status']) {
      if (!(key in todo)) push(file, `todo[${index}] missing ${key}`);
    }
    if (!validTodoStatuses.has(todo.status)) push(file, `todo[${index}] invalid status "${todo.status}"`);
  }

  if (['completed', 'cancelled'].includes(data.stage)) {
    for (const [index, todo] of todos.entries()) {
      if (todo.status === 'in_progress') push(file, `completed/cancelled state cannot have todo[${index}] in_progress`);
    }
  }

  if (data.stage === 'repairing' && typeof data.repair_direction !== 'string') {
    push(file, 'repairing stage requires non-null repair_direction');
  }
  if (data.stage === 'repairing' && data.current_owner !== data.first_executor) {
    push(file, 'repairing current_owner must equal first_executor');
  }

  if (data.stage === 'paused' && (!data.next_action || data.next_action.length === 0)) {
    push(file, 'paused stage requires next_action');
  }
}

function validateRules() {
  for (const density of densityValues) {
    if (!rules.density_stage_paths[density]) push('rules.json', `missing density_stage_paths.${density}`);
  }

  for (const [density, stages] of Object.entries(rules.density_stage_paths)) {
    if (!densityValues.has(density)) push('rules.json', `density_stage_paths has unknown density "${density}"`);
    for (const stage of stages) {
      if (!stageValues.has(stage)) push('rules.json', `density_stage_paths.${density} has unknown stage "${stage}"`);
    }
  }

  for (const event of eventValues) {
    if (event !== 'TASK_CREATED' && !rules.event_stage_transitions[event]) {
      push('rules.json', `missing event_stage_transitions.${event}`);
    }
  }

  for (const [event, transition] of Object.entries(rules.event_stage_transitions)) {
    if (!eventValues.has(event)) push('rules.json', `event_stage_transitions has unknown event "${event}"`);
    const targets = typeof transition === 'string' ? [transition] : Object.values(transition);
    for (const target of targets) {
      if (target !== '__preserve_current_stage__' && !stageValues.has(target)) {
        push('rules.json', `event_stage_transitions.${event} has unknown target stage "${target}"`);
      }
    }
  }

  if (rules.verification.level_defaults.low !== 'optional') push('rules.json', 'low verification default must be optional');
  if (rules.limits.consecutive_verify_fail_limit !== 3) push('rules.json', 'consecutive_verify_fail_limit must be 3');
}

function validateDocsAndSkills() {
  const rootReadme = readText(path.join(repoRoot, 'README.md'));
  const pluginReadme = readText(path.join(root, 'README.md'));
  const designSkill = readText(path.join(skillsDir, 'design', 'SKILL.md'));
  const verifySkill = readText(path.join(skillsDir, 'verify', 'SKILL.md'));
  const reviewingSkill = readText(path.join(skillsDir, 'reviewing', 'SKILL.md'));
  const handoffSkill = readText(path.join(skillsDir, 'handoff', 'SKILL.md'));

  requireText('README.md', rootReadme, 'triaged -> executing -> verifying -> completed');
  requireText('README.md', rootReadme, '必须停止循环，用 AskUserQuestion 让用户决定升级 / 重设方案 / 取消');
  if (rootReadme.includes('verifying_optional')) push('README.md', 'must not mention verifying_optional');
  if (rootReadme.includes('必须进入 `paused`')) push('README.md', 'verify fail limit must ask user instead of forcing paused');

  requireText('plugins/orbit/README.md', pluginReadme, '`low`：`triaged → executing → verifying → completed`');
  requireText('skills/design/SKILL.md', designSkill, '## User Approval');
  requireText('skills/verify/SKILL.md', verifySkill, '## Evaluator Verdict');
  requireText('skills/reviewing/SKILL.md', reviewingSkill, '## Spec Compliance Verdict');
  requireText('skills/reviewing/SKILL.md', reviewingSkill, '## Code Quality Verdict');
  requireText('skills/handoff/SKILL.md', handoffSkill, '`task_id`、`density`、`stage`、`status`、`task_summary`、`current_focus`、`next_action`');
  if (handoffSkill.includes('/pause')) push('skills/handoff/SKILL.md', 'must not reference slash command /pause');
}

// CLI 模式：
//   - 默认（无参数）：自检 schema / rules / docs / examples 一致性
//   - `--runtime <path>`：仅校验单个 runtime.json（供 skill 退出前自检使用）
const argv = process.argv.slice(2);
const runtimeFlagIndex = argv.indexOf('--runtime');
if (runtimeFlagIndex !== -1) {
  const runtimePath = argv[runtimeFlagIndex + 1];
  if (!runtimePath) {
    console.error('--runtime requires a path argument');
    process.exit(2);
  }
  const absRuntimePath = path.resolve(process.cwd(), runtimePath);
  if (!fs.existsSync(absRuntimePath)) {
    console.error(`runtime file not found: ${absRuntimePath}`);
    process.exit(2);
  }
  let runtimeData;
  try {
    runtimeData = readJson(absRuntimePath);
  } catch (e) {
    console.error(`failed to parse ${absRuntimePath}: ${e.message}`);
    process.exit(2);
  }
  validateRuntimeShape(runtimePath, runtimeData);
  if (errors.length > 0) {
    console.error(`Orbit runtime validation failed (${errors.length} issue${errors.length === 1 ? '' : 's'}):`);
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log(`Orbit runtime validation passed: ${runtimePath}`);
  process.exit(0);
}

validatePluginMetadata();
validateSchemaBasics('runtime-state.schema.json', schema);
validateSchemaBasics('task-packet.schema.json', taskPacketSchema);
validateSchemaBasics('handoff.schema.json', handoffSchema);
validateRules();
validateDocsAndSkills();

for (const entry of fs.readdirSync(examplesDir).filter((name) => name.endsWith('.json')).sort()) {
  const file = path.join(examplesDir, entry);
  const exampleErrors = [];
  activeErrors = exampleErrors;
  validateRuntimeShape(`examples/${entry}`, readJson(file));
  activeErrors = errors;
  const producedErrors = exampleErrors.length > 0;
  if (entry.startsWith('valid-')) {
    errors.push(...exampleErrors);
  }
  if (entry.startsWith('invalid-') && !producedErrors) {
    push(`examples/${entry}`, 'expected invalid example, but validator found no issues');
  }
}

if (errors.length > 0) {
  console.error(`Orbit state validation failed (${errors.length} issue${errors.length === 1 ? '' : 's'}):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('Orbit state validation passed.');
