import mysql from "mysql2/promise";
import { v4 as uuidv4 } from "uuid";

let pool = null;

export function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST || "localhost",
      port: parseInt(process.env.DB_PORT || "3306"),
      user: process.env.DB_USER || "taskuser",
      password: process.env.DB_PASSWORD || "taskpass123",
      database: process.env.DB_NAME || "task_refiner",
      waitForConnections: true,
      connectionLimit: 10,
      charset: "utf8mb4",
    });
  }
  return pool;
}

// ══════════════════════════════════════════════════════════════
// AGENTS
// ══════════════════════════════════════════════════════════════

export async function createAgent({ name, description, icon, systemPrompt, contextText, outputFormat, model, maxTokens }) {
  const db = getPool();
  const id = uuidv4();
  await db.execute(
    `INSERT INTO agents (id, name, description, icon, system_prompt, context_text, output_format, model, max_tokens)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, name, description || null, icon || "🤖", systemPrompt, contextText || null, outputFormat || null, model || "claude-sonnet-4-20250514", maxTokens || 4000]
  );
  return getAgentById(id);
}

export async function updateAgent(id, { name, description, icon, systemPrompt, contextText, outputFormat, model, maxTokens }) {
  const db = getPool();
  await db.execute(
    `UPDATE agents SET name=?, description=?, icon=?, system_prompt=?, context_text=?, output_format=?, model=?, max_tokens=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    [name, description || null, icon || "🤖", systemPrompt, contextText || null, outputFormat || null, model || "claude-sonnet-4-20250514", maxTokens || 4000, id]
  );
  return getAgentById(id);
}

export async function deleteAgent(id) {
  const db = getPool();
  // Don't delete default agent
  const [rows] = await db.execute("SELECT is_default FROM agents WHERE id = ?", [id]);
  if (rows.length > 0 && rows[0].is_default) {
    throw new Error("Cannot delete the default agent");
  }
  await db.execute("DELETE FROM agents WHERE id = ?", [id]);
}

export async function getAllAgents() {
  const db = getPool();
  const [rows] = await db.execute("SELECT * FROM agents ORDER BY is_default DESC, name ASC");
  return rows.map(dbRowToAgent);
}

export async function getAgentById(id) {
  const db = getPool();
  const [rows] = await db.execute("SELECT * FROM agents WHERE id = ?", [id]);
  if (rows.length === 0) return null;
  return dbRowToAgent(rows[0]);
}

export async function getDefaultAgent() {
  const db = getPool();
  const [rows] = await db.execute("SELECT * FROM agents WHERE is_default = TRUE LIMIT 1");
  if (rows.length === 0) return null;
  return dbRowToAgent(rows[0]);
}

export async function setDefaultAgent(id) {
  const db = getPool();
  await db.execute("UPDATE agents SET is_default = FALSE WHERE is_default = TRUE");
  await db.execute("UPDATE agents SET is_default = TRUE WHERE id = ?", [id]);
}

function dbRowToAgent(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    icon: row.icon,
    systemPrompt: row.system_prompt,
    contextText: row.context_text,
    outputFormat: row.output_format,
    model: row.model,
    maxTokens: row.max_tokens,
    isDefault: !!row.is_default,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ══════════════════════════════════════════════════════════════
// AGENT IMAGES
// ══════════════════════════════════════════════════════════════

export async function addAgentImage(agentId, filename, mimeType, data) {
  const db = getPool();
  const id = uuidv4();
  await db.execute(
    "INSERT INTO agent_images (id, agent_id, filename, mime_type, data) VALUES (?, ?, ?, ?, ?)",
    [id, agentId, filename, mimeType, data]
  );
  return { id, agentId, filename, mimeType, createdAt: new Date() };
}

export async function getAgentImages(agentId) {
  const db = getPool();
  const [rows] = await db.execute(
    "SELECT id, agent_id, filename, mime_type, created_at FROM agent_images WHERE agent_id = ? ORDER BY created_at ASC",
    [agentId]
  );
  return rows.map((r) => ({
    id: r.id,
    agentId: r.agent_id,
    filename: r.filename,
    mimeType: r.mime_type,
    createdAt: r.created_at,
  }));
}

export async function getAgentImageData(imageId) {
  const db = getPool();
  const [rows] = await db.execute("SELECT * FROM agent_images WHERE id = ?", [imageId]);
  if (rows.length === 0) return null;
  return { id: rows[0].id, mimeType: rows[0].mime_type, data: rows[0].data, filename: rows[0].filename };
}

export async function getAgentImagesWithData(agentId) {
  const db = getPool();
  const [rows] = await db.execute(
    "SELECT id, mime_type, data FROM agent_images WHERE agent_id = ?",
    [agentId]
  );
  return rows.map((r) => ({
    id: r.id,
    mimeType: r.mime_type,
    data: r.data,
  }));
}

export async function deleteAgentImage(imageId) {
  const db = getPool();
  await db.execute("DELETE FROM agent_images WHERE id = ?", [imageId]);
}

// ══════════════════════════════════════════════════════════════
// TASK IMAGES
// ══════════════════════════════════════════════════════════════

export async function addTaskImage(taskId, filename, mimeType, data) {
  const db = getPool();
  const id = uuidv4();
  await db.execute(
    "INSERT INTO task_images (id, task_id, filename, mime_type, data) VALUES (?, ?, ?, ?, ?)",
    [id, taskId, filename, mimeType, data]
  );
  return { id, taskId, filename, mimeType, createdAt: new Date() };
}

export async function getTaskImages(taskId) {
  const db = getPool();
  const [rows] = await db.execute(
    "SELECT id, task_id, filename, mime_type, created_at FROM task_images WHERE task_id = ? ORDER BY created_at ASC",
    [taskId]
  );
  return rows.map((r) => ({
    id: r.id,
    taskId: r.task_id,
    filename: r.filename,
    mimeType: r.mime_type,
    createdAt: r.created_at,
  }));
}

export async function getTaskImagesWithData(taskId) {
  const db = getPool();
  const [rows] = await db.execute(
    "SELECT id, mime_type, data FROM task_images WHERE task_id = ?",
    [taskId]
  );
  return rows.map((r) => ({
    id: r.id,
    mimeType: r.mime_type,
    data: r.data,
  }));
}

export async function getTaskImageData(imageId) {
  const db = getPool();
  const [rows] = await db.execute("SELECT * FROM task_images WHERE id = ?", [imageId]);
  if (rows.length === 0) return null;
  return { id: rows[0].id, mimeType: rows[0].mime_type, data: rows[0].data, filename: rows[0].filename };
}

// ══════════════════════════════════════════════════════════════
// CONVERSATIONS
// ══════════════════════════════════════════════════════════════

export async function addConversationMessage(taskId, role, content) {
  const db = getPool();
  const id = uuidv4();
  await db.execute(
    "INSERT INTO conversations (id, task_id, role, content) VALUES (?, ?, ?, ?)",
    [id, taskId, role, content]
  );
  return { id, taskId, role, content, createdAt: new Date() };
}

export async function getConversationByTaskId(taskId) {
  const db = getPool();
  const [rows] = await db.execute(
    "SELECT * FROM conversations WHERE task_id = ? ORDER BY created_at ASC",
    [taskId]
  );
  return rows.map((r) => ({
    id: r.id,
    taskId: r.task_id,
    role: r.role,
    content: r.content,
    createdAt: r.created_at,
  }));
}

export async function getConversationChain(taskId) {
  // Get conversation for this task AND all parent tasks (re-refinements)
  const db = getPool();
  const taskIds = [taskId];

  // Walk up the parent chain
  let currentId = taskId;
  while (currentId) {
    const [rows] = await db.execute("SELECT parent_id FROM tasks WHERE id = ?", [currentId]);
    if (rows.length > 0 && rows[0].parent_id) {
      taskIds.unshift(rows[0].parent_id);
      currentId = rows[0].parent_id;
    } else {
      break;
    }
  }

  // Get all conversations for the chain
  const placeholders = taskIds.map(() => "?").join(",");
  const [rows] = await db.execute(
    `SELECT c.*, t.version FROM conversations c JOIN tasks t ON c.task_id = t.id WHERE c.task_id IN (${placeholders}) ORDER BY c.created_at ASC`,
    taskIds
  );

  return rows.map((r) => ({
    id: r.id,
    taskId: r.task_id,
    role: r.role,
    content: r.content,
    version: r.version,
    createdAt: r.created_at,
  }));
}

// ══════════════════════════════════════════════════════════════
// TASKS
// ══════════════════════════════════════════════════════════════

export async function saveTask(job) {
  const db = getPool();
  const r = job.result || {};

  await db.execute(
    `INSERT INTO tasks (id, raw_task, title, description, epic, effort, effort_points,
      suggested_assignee_role, status, result, error, reject_reason, version, parent_id, improvement_notes, agent_id,
      pipeline_mode, validator_agent_id, validation_status, validation_notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       title = VALUES(title),
       description = VALUES(description),
       epic = VALUES(epic),
       effort = VALUES(effort),
       effort_points = VALUES(effort_points),
       suggested_assignee_role = VALUES(suggested_assignee_role),
       status = VALUES(status),
       result = VALUES(result),
       error = VALUES(error),
       reject_reason = VALUES(reject_reason),
       version = VALUES(version),
       improvement_notes = VALUES(improvement_notes),
       agent_id = VALUES(agent_id),
       pipeline_mode = VALUES(pipeline_mode),
       validator_agent_id = VALUES(validator_agent_id),
       validation_status = VALUES(validation_status),
       validation_notes = VALUES(validation_notes),
       updated_at = CURRENT_TIMESTAMP`,
    [
      job.id,
      job.rawTask,
      r.title || null,
      r.description || null,
      r.epic || null,
      r.effort || null,
      r.effort_points || null,
      r.suggested_assignee_role || null,
      job.status,
      job.result ? JSON.stringify(job.result) : null,
      job.error || null,
      job.rejectReason || null,
      job.version || 1,
      job.parentId || null,
      job.improvementNotes || null,
      job.agentId || null,
      job.pipelineMode || "simple",
      job.validatorAgentId || null,
      job.validationStatus || null,
      job.validationNotes ? JSON.stringify(job.validationNotes) : null,
    ]
  );
}

export async function getAllTasks({ page = 1, limit = 50, status = null, search = null } = {}) {
  const db = getPool();
  const offset = (page - 1) * limit;
  let where = "WHERE 1=1";
  const params = [];

  if (status) {
    where += " AND t.status = ?";
    params.push(status);
  }
  if (search) {
    where += " AND (t.title LIKE ? OR t.raw_task LIKE ?)";
    params.push(`%${search}%`, `%${search}%`);
  }

  const [countRows] = await db.execute(
    `SELECT COUNT(*) as total FROM tasks t ${where}`,
    params
  );

  const safeLimit = parseInt(limit) || 50;
  const safeOffset = parseInt(offset) || 0;

  const [rows] = await db.execute(
    `SELECT t.*, a.name as agent_name, a.icon as agent_icon, va.name as validator_agent_name, va.icon as validator_agent_icon
     FROM tasks t
     LEFT JOIN agents a ON t.agent_id = a.id
     LEFT JOIN agents va ON t.validator_agent_id = va.id
     ${where} ORDER BY t.created_at DESC LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    params
  );

  return {
    tasks: rows.map(dbRowToTask),
    total: countRows[0].total,
    page,
    limit,
    totalPages: Math.ceil(countRows[0].total / limit),
  };
}

export async function getTaskById(id) {
  const db = getPool();
  const [rows] = await db.execute(
    `SELECT t.*, a.name as agent_name, a.icon as agent_icon, va.name as validator_agent_name, va.icon as validator_agent_icon
     FROM tasks t LEFT JOIN agents a ON t.agent_id = a.id LEFT JOIN agents va ON t.validator_agent_id = va.id WHERE t.id = ?`,
    [id]
  );
  if (rows.length === 0) return null;
  return dbRowToTask(rows[0]);
}

export async function getTaskHistory(id) {
  const db = getPool();
  let rootId = id;
  let current = await getTaskById(id);
  while (current && current.parentId) {
    rootId = current.parentId;
    current = await getTaskById(current.parentId);
  }

  const [rows] = await db.execute(
    `SELECT t.*, a.name as agent_name, a.icon as agent_icon, va.name as validator_agent_name, va.icon as validator_agent_icon
     FROM tasks t LEFT JOIN agents a ON t.agent_id = a.id LEFT JOIN agents va ON t.validator_agent_id = va.id
     WHERE t.id = ? OR t.parent_id = ? ORDER BY t.version ASC`,
    [rootId, rootId]
  );

  const allIds = rows.map((r) => r.id);
  if (allIds.length > 0) {
    const placeholders = allIds.map(() => "?").join(",");
    const [childRows] = await db.execute(
      `SELECT t.*, a.name as agent_name, a.icon as agent_icon, va.name as validator_agent_name, va.icon as validator_agent_icon
       FROM tasks t LEFT JOIN agents a ON t.agent_id = a.id LEFT JOIN agents va ON t.validator_agent_id = va.id
       WHERE t.parent_id IN (${placeholders}) AND t.id NOT IN (${placeholders}) ORDER BY t.version ASC`,
      [...allIds, ...allIds]
    );
    rows.push(...childRows);
  }

  return rows.map(dbRowToTask).sort((a, b) => a.version - b.version);
}

export async function deleteTask(id) {
  const db = getPool();
  await db.execute("DELETE FROM tasks WHERE id = ?", [id]);
}

function dbRowToTask(row) {
  let validationNotes = row.validation_notes;
  if (typeof validationNotes === "string") {
    try { validationNotes = JSON.parse(validationNotes); } catch { validationNotes = null; }
  }
  return {
    id: row.id,
    rawTask: row.raw_task,
    title: row.title,
    description: row.description,
    epic: row.epic,
    effort: row.effort,
    effortPoints: row.effort_points,
    suggestedAssigneeRole: row.suggested_assignee_role,
    status: row.status,
    result: typeof row.result === "string" ? JSON.parse(row.result) : row.result,
    error: row.error,
    rejectReason: row.reject_reason,
    version: row.version,
    parentId: row.parent_id,
    improvementNotes: row.improvement_notes,
    agentId: row.agent_id,
    agentName: row.agent_name || null,
    agentIcon: row.agent_icon || null,
    pipelineMode: row.pipeline_mode || "simple",
    validatorAgentId: row.validator_agent_id || null,
    validatorAgentName: row.validator_agent_name || null,
    validatorAgentIcon: row.validator_agent_icon || null,
    validationStatus: row.validation_status || null,
    validationNotes: validationNotes || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ══════════════════════════════════════════════════════════════
// AGENT FEEDBACK (approved / rejected examples for reinforcement)
// ══════════════════════════════════════════════════════════════

/**
 * Get recent approved and rejected tasks for a given agent.
 * Used as few-shot reinforcement learning in the system prompt.
 * Returns { approved: [...], rejected: [...], approvedCount, rejectedCount }
 */
export async function getAgentFeedbackExamples(agentId, { maxApproved = 3, maxRejected = 3 } = {}) {
  const db = getPool();

  // Get total counts (always)
  const [countRows] = await db.execute(
    `SELECT 
       SUM(CASE WHEN status IN ('approved', 'published') THEN 1 ELSE 0 END) as approved_count,
       SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected_count
     FROM tasks WHERE agent_id = ? AND result IS NOT NULL`,
    [agentId]
  );
  const approvedCount = parseInt(countRows[0].approved_count) || 0;
  const rejectedCount = parseInt(countRows[0].rejected_count) || 0;

  // Approved / published tasks (positive examples)
  let approvedRows = [];
  if (maxApproved > 0) {
    const [rows] = await db.execute(
      `SELECT raw_task, result, title FROM tasks
       WHERE agent_id = ? AND status IN ('approved', 'published') AND result IS NOT NULL
       ORDER BY updated_at DESC LIMIT ?`,
      [agentId, maxApproved]
    );
    approvedRows = rows;
  }

  // Rejected tasks (negative examples — with rejection reason)
  let rejectedRows = [];
  if (maxRejected > 0) {
    const [rows] = await db.execute(
      `SELECT raw_task, result, title, reject_reason FROM tasks
       WHERE agent_id = ? AND status = 'rejected' AND result IS NOT NULL
       ORDER BY updated_at DESC LIMIT ?`,
      [agentId, maxRejected]
    );
    rejectedRows = rows;
  }

  return {
    approvedCount,
    rejectedCount,
    approved: approvedRows.map(r => ({
      rawTask: r.raw_task,
      result: typeof r.result === "string" ? JSON.parse(r.result) : r.result,
      title: r.title,
    })),
    rejected: rejectedRows.map(r => ({
      rawTask: r.raw_task,
      result: typeof r.result === "string" ? JSON.parse(r.result) : r.result,
      title: r.title,
      rejectReason: r.reject_reason,
    })),
  };
}

// ══════════════════════════════════════════════════════════════
// TOKEN USAGE TRACKING
// ══════════════════════════════════════════════════════════════

export async function saveTokenUsage(taskId, agentId, usage, pipelineStep = null) {
  const db = getPool();
  const id = uuidv4();
  await db.execute(
    `INSERT INTO token_usage (id, task_id, agent_id, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, pipeline_step)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      taskId,
      agentId,
      usage.inputTokens || 0,
      usage.outputTokens || 0,
      usage.cacheCreationTokens || 0,
      usage.cacheReadTokens || 0,
      pipelineStep,
    ]
  );
}

export async function getTokenUsageStats() {
  const db = getPool();
  const [rows] = await db.execute(`
    SELECT 
      COUNT(*) as total_calls,
      SUM(input_tokens) as total_input,
      SUM(output_tokens) as total_output,
      SUM(cache_read_tokens) as total_cache_read,
      SUM(cache_creation_tokens) as total_cache_write,
      SUM(input_tokens + output_tokens) as total_tokens
    FROM token_usage
  `);
  return rows[0];
}
