import Anthropic from "@anthropic-ai/sdk";
import {
  getAgentById,
  getDefaultAgent,
  getAgentImagesWithData,
  getTaskImagesWithData,
  addConversationMessage,
  getTaskById,
  saveTokenUsage,
  getAgentFeedbackExamples,
} from "./database.js";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MAX_JSON_RETRIES = 2;
const MAX_RATE_LIMIT_RETRIES = 3;
const RATE_LIMIT_BASE_DELAY_MS = 30_000; // 30s base wait

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Wrapper around client.messages.create that handles 429 rate-limit errors
 * with exponential backoff. Other errors are thrown immediately.
 */
async function callClaudeWithRateLimit({ model, max_tokens, system, messages }) {
  for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt++) {
    try {
      return await client.messages.create({ model, max_tokens, system, messages });
    } catch (err) {
      const isRateLimit =
        err?.status === 429 ||
        err?.error?.type === "rate_limit_error" ||
        (err?.message && err.message.includes("rate_limit"));

      if (!isRateLimit || attempt >= MAX_RATE_LIMIT_RETRIES) {
        throw err;
      }

      // Parse retry-after header if available, otherwise use exponential backoff
      const retryAfterSec = err?.headers?.["retry-after"];
      const waitMs = retryAfterSec
        ? parseInt(retryAfterSec, 10) * 1000
        : RATE_LIMIT_BASE_DELAY_MS * Math.pow(1.5, attempt);

      console.warn(
        `[Rate Limit] Hit rate limit, waiting ${Math.round(waitMs / 1000)}s before retry ${attempt + 1}/${MAX_RATE_LIMIT_RETRIES}...`
      );

      await sleep(waitMs);
    }
  }
}

function tryParseJson(text) {
  const normalized = String(text || "").trim();
  const clean = normalized.replace(/```json|```/gi, "").trim();

  const candidates = [clean];
  const extracted = extractFirstJsonBlock(clean);
  if (extracted && extracted !== clean) {
    candidates.push(extracted);
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next candidate.
    }
  }

  return null; // parse failed
}

/**
 * Call Claude and ensure the response is valid JSON.
 * If the first response isn't valid JSON, automatically retry by feeding
 * the invalid response back and asking the model to return ONLY JSON.
 */
async function callClaudeExpectingJson({
  model,
  maxTokens,
  system,
  messages,
  stepLabel = "agent",
}) {
  let lastText = "";

  for (let attempt = 0; attempt <= MAX_JSON_RETRIES; attempt++) {
    const currentMessages = attempt === 0
      ? messages
      : [
          ...messages,
          { role: "assistant", content: lastText },
          {
            role: "user",
            content:
              "Sua resposta anterior NÃO é um JSON válido. Retorne APENAS o objeto JSON, sem markdown, sem explicações, sem comentários — apenas o JSON puro começando com { e terminando com }.",
          },
        ];

    const response = await callClaudeWithRateLimit({
      model,
      max_tokens: maxTokens,
      system,
      messages: currentMessages,
    });

    const text = response.content[0].text.trim();
    const parsed = tryParseJson(text);

    if (parsed !== null) {
      return { result: parsed, text, response };
    }

    // Parse failed — log and retry
    console.warn(
      `[${stepLabel}] Attempt ${attempt + 1}/${MAX_JSON_RETRIES + 1}: response is not valid JSON, ${attempt < MAX_JSON_RETRIES ? "retrying..." : "giving up."}`
    );
    lastText = text;
  }

  // All retries exhausted
  const preview = lastText.slice(0, 240).replace(/\s+/g, " ");
  throw new Error(
    `O ${stepLabel} não retornou JSON válido após ${MAX_JSON_RETRIES + 1} tentativas. Última resposta: ${preview}${lastText.length > 240 ? "..." : ""}`
  );
}

function extractFirstJsonBlock(text) {
  const start = text.search(/[\[{]/);
  if (start === -1) return null;

  const opening = text[start];
  const closing = opening === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === opening) {
      depth++;
      continue;
    }

    if (char === closing) {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1).trim();
      }
    }
  }

  return null;
}

// ══════════════════════════════════════════════════════════════
// PUBLIC API
// ══════════════════════════════════════════════════════════════

/**
 * Refine a task. Supports two modes:
 *  - "simple"   → single-agent refinement (current behavior)
 *  - "pipeline" → two-agent chain: Refiner → Validator
 *
 * Returns { result, validationStatus, validationNotes }
 */
export async function refineTask(
  rawTask,
  {
    agentId = null,
    improvementNotes = null,
    taskId = null,
    pipelineMode = "simple",
    validatorAgentId = null,
    onProgress = null, // callback(step) for pipeline progress tracking
  } = {}
) {
  const emit = (step, status, extra = {}) => {
    if (onProgress) {
      onProgress({ step, status, timestamp: new Date().toISOString(), ...extra });
    }
  };

  if (pipelineMode === "pipeline") {
    emit("refiner", "running");
  } else {
    emit("refiner", "running");
  }

  // ── Step 1: Refiner ──────────────────────────────────────
  let refinerResult;
  try {
    refinerResult = await runRefiner(rawTask, {
      agentId,
      improvementNotes,
      taskId,
      pipelineStep: pipelineMode === "pipeline" ? "refiner" : null,
    });
    emit("refiner", "done");
  } catch (err) {
    emit("refiner", "error", { error: err.message });
    throw err;
  }

  if (pipelineMode !== "pipeline") {
    // Simple mode — return as-is
    return {
      result: refinerResult,
      validationStatus: null,
      validationNotes: null,
      pipelineSteps: null,
    };
  }

  // ── Step 2: Validator ────────────────────────────────────
  console.log(`[Pipeline] task=${taskId || "?"} | Refiner complete, starting Validator...`);
  emit("validator", "running");

  let validatedResult, validationStatus, validationNotes;
  try {
    ({ result: validatedResult, validationStatus, validationNotes } = await runValidator(
      rawTask,
      refinerResult,
      {
        validatorAgentId,
        taskId,
      }
    ));
    emit("validator", "done", { validationStatus });
  } catch (err) {
    emit("validator", "error", { error: err.message });
    throw err;
  }

  return { result: validatedResult, validationStatus, validationNotes };
}

// ══════════════════════════════════════════════════════════════
// REFINER (Step 1) — existing single-agent logic
// ══════════════════════════════════════════════════════════════

async function runRefiner(
  rawTask,
  { agentId = null, improvementNotes = null, taskId = null, pipelineStep = null } = {}
) {
  // ── Load agent config ──────────────────────────────────────
  let agent = agentId ? await getAgentById(agentId) : await getDefaultAgent();
  if (!agent) agent = await getDefaultAgent();
  if (!agent) throw new Error("No agent configured. Create an agent first.");

  const isReRefine = !!improvementNotes;

  // ── Build system prompt with cache_control ─────────────────
  const systemParts = [];
  systemParts.push(agent.systemPrompt);

  if (agent.contextText) {
    systemParts.push(`\nCONTEXTO DO PROJETO:\n${agent.contextText}`);
  }

  const hasCustomFormat = !!agent.outputFormat;

  if (hasCustomFormat) {
    systemParts.push(
      `\nIMPORTANTE — FORMATO DE SAÍDA CUSTOMIZADO:
Você DEVE retornar APENAS um JSON válido seguindo EXATAMENTE o formato abaixo. Não adicione campos extras, não use outro formato, não retorne markdown ou explicações.
Use SOMENTE as chaves definidas neste template:
${agent.outputFormat}

REGRAS:
- Retorne APENAS o JSON, sem texto antes ou depois.
- Siga EXATAMENTE a estrutura de chaves do template acima.
- NÃO use formato Jira, Scrum ou qualquer outro padrão a menos que o template acima especifique.
- Preencha os valores com conteúdo relevante baseado na task fornecida.`
    );
  } else {
    const defaultFormat = `{
  "title": "título claro e objetivo da task",
  "description": "contexto do problema, objetivo e abordagem técnica recomendada",
  "epic": "épico relacionado ou null",
  "subtasks": [
    { "title": "subtask 1", "description": "detalhe técnico" }
  ],
  "acceptance_criteria": [
    { "given": "...", "when": "...", "then": "..." }
  ],
  "effort": "P | M | G | GG",
  "effort_points": 1,
  "dependencies": ["dependência 1"],
  "risks": ["risco técnico 1"],
  "labels": ["label1"],
  "suggested_assignee_role": "Frontend | Backend | DevOps | Fullstack"
}`;

    systemParts.push(
      `\nRETORNE APENAS um JSON válido, sem markdown, sem explicações, neste formato:\n${defaultFormat}\n\neffort_points: P=1, M=3, G=5, GG=8 (story points)`
    );
  }

  // ── Inject feedback from approved/rejected tasks ────────────
  try {
    const feedback = await getAgentFeedbackExamples(agent.id);
    const feedbackParts = [];

    // Helper: truncate large JSON to avoid token overload (max ~2000 chars per example)
    const truncateJson = (obj, maxLen = 2000) => {
      const str = JSON.stringify(obj, null, 2);
      if (str.length <= maxLen) return str;
      return str.slice(0, maxLen) + "\n  // ... (truncado para economizar tokens)";
    };

    if (feedback.approved.length > 0) {
      feedbackParts.push(`\n══ EXEMPLOS APROVADOS (o que deu certo — siga este padrão) ══`);
      feedback.approved.forEach((ex, i) => {
        feedbackParts.push(`\n--- Exemplo ${i + 1} (✅ Aprovado) ---`);
        feedbackParts.push(`Task crua: "${ex.rawTask}"`);
        feedbackParts.push(`Resultado:\n${truncateJson(ex.result)}`);
      });
    }

    if (feedback.rejected.length > 0) {
      feedbackParts.push(`\n══ EXEMPLOS REJEITADOS (o que deu errado — EVITE estes padrões) ══`);
      feedback.rejected.forEach((ex, i) => {
        feedbackParts.push(`\n--- Exemplo ${i + 1} (❌ Rejeitado) ---`);
        feedbackParts.push(`Task crua: "${ex.rawTask}"`);
        feedbackParts.push(`Resultado rejeitado:\n${truncateJson(ex.result)}`);
        if (ex.rejectReason) {
          feedbackParts.push(`Motivo da rejeição: ${ex.rejectReason}`);
        }
      });
    }

    if (feedbackParts.length > 0) {
      systemParts.push(feedbackParts.join("\n"));
      systemParts.push(
        `\nUse os exemplos aprovados como referência de qualidade e tom. Evite os problemas apontados nos exemplos rejeitados.`
      );
      console.log(
        `[Feedback] agent=${agent.id} | ${feedback.approved.length} approved, ${feedback.rejected.length} rejected examples injected`
      );
    }
  } catch (err) {
    console.error("[Feedback] Failed to load feedback examples:", err.message);
  }

  if (isReRefine) {
    systemParts.push(
      `\nRE-REFINAMENTO: O usuário quer melhorias na task já refinada. Ajuste o JSON de acordo com os pontos fornecidos.`
    );
  }

  const system = [
    {
      type: "text",
      text: systemParts.join("\n"),
      cache_control: { type: "ephemeral" },
    },
  ];

  // ── Build messages ─────────────────────────────────────────
  const messages = [];

  if (isReRefine && taskId) {
    const parentTask = await getParentResult(taskId);
    if (parentTask) {
      messages.push({
        role: "user",
        content: `Refine esta task: "${rawTask}"`,
      });
      messages.push({
        role: "assistant",
        content: JSON.stringify(parentTask, null, 2),
      });
    }

    const reRefineContentParts = [];

    if (taskId) {
      const rootTaskId = await getRootTaskId(taskId);
      const taskImages = await getTaskImagesWithData(rootTaskId);
      for (const img of taskImages) {
        const base64 = img.data.toString("base64");
        const mediaType = img.mimeType || "image/png";
        reRefineContentParts.push({
          type: "image",
          source: { type: "base64", media_type: mediaType, data: base64 },
        });
      }
    }

    reRefineContentParts.push({
      type: "text",
      text: `Pontos de melhoria para ajustar a task refinada acima:\n${improvementNotes}`,
    });

    messages.push({
      role: "user",
      content: reRefineContentParts.length === 1
        ? `Pontos de melhoria para ajustar a task refinada acima:\n${improvementNotes}`
        : reRefineContentParts,
    });
  } else {
    const userContentParts = [];

    // Agent context images
    const agentImages = await getAgentImagesWithData(agent.id);
    if (agentImages.length > 0) {
      for (let i = 0; i < agentImages.length; i++) {
        const img = agentImages[i];
        const base64 = img.data.toString("base64");
        const mediaType = img.mimeType || "image/png";
        const block = {
          type: "image",
          source: { type: "base64", media_type: mediaType, data: base64 },
        };
        if (i === agentImages.length - 1) {
          block.cache_control = { type: "ephemeral" };
        }
        userContentParts.push(block);
      }
    }

    // Task-specific images
    if (taskId) {
      const taskImages = await getTaskImagesWithData(taskId);
      for (const img of taskImages) {
        const base64 = img.data.toString("base64");
        const mediaType = img.mimeType || "image/png";
        userContentParts.push({
          type: "image",
          source: { type: "base64", media_type: mediaType, data: base64 },
        });
      }
    }

    userContentParts.push({
      type: "text",
      text: `Refine esta task: "${rawTask}"`,
    });

    messages.push({
      role: "user",
      content: userContentParts.length === 1
        ? `Refine esta task: "${rawTask}"`
        : userContentParts,
    });
  }

  // ── Call Claude (with JSON retry) ───────────────────────────
  const currentStepLabel = pipelineStep || "refiner";
  const { result, text, response } = await callClaudeExpectingJson({
    model: agent.model || "claude-sonnet-4-20250514",
    maxTokens: agent.maxTokens || 4000,
    system,
    messages,
    stepLabel: currentStepLabel,
  });

  // ── Save conversation ───────────────────────────────────────
  if (taskId) {
    const isReRefine2 = !!improvementNotes;
    const userText = isReRefine2
      ? `[Re-refinamento] ${improvementNotes}`
      : `Refine: "${rawTask}"`;
    await addConversationMessage(taskId, "user", userText);
    await addConversationMessage(taskId, "assistant", pipelineStep ? `[Refiner] ${text}` : text);
  }

  // ── Track token usage ──────────────────────────────────────
  const usage = response.usage || {};
  const tokenInfo = {
    inputTokens: usage.input_tokens || 0,
    outputTokens: usage.output_tokens || 0,
    cacheCreationTokens: usage.cache_creation_input_tokens || 0,
    cacheReadTokens: usage.cache_read_input_tokens || 0,
  };

  const stepLabel = pipelineStep ? ` [${pipelineStep}]` : "";
  console.log(
    `[Tokens]${stepLabel} task=${taskId || "?"} | in=${tokenInfo.inputTokens} out=${tokenInfo.outputTokens} cache_read=${tokenInfo.cacheReadTokens} cache_write=${tokenInfo.cacheCreationTokens}`
  );

  if (taskId) {
    try {
      await saveTokenUsage(taskId, agent.id, tokenInfo, pipelineStep);
    } catch (err) {
      console.error("[DB] Failed to save token usage:", err.message);
    }
  }

  return result;
}

// ══════════════════════════════════════════════════════════════
// VALIDATOR (Step 2) — validates and patches the Refiner output
// ══════════════════════════════════════════════════════════════

async function runValidator(rawTask, refinerResult, { validatorAgentId = null, taskId = null } = {}) {
  // Load validator agent (or fall back to the seeded default validator)
  let validator = validatorAgentId ? await getAgentById(validatorAgentId) : null;
  if (!validator) {
    validator = await getAgentById("default-validator-001");
  }
  if (!validator) {
    // If no validator agent exists at all, return refiner result as-is (approved)
    console.warn("[Pipeline] No validator agent found, skipping validation");
    return { result: refinerResult, validationStatus: "approved", validationNotes: [] };
  }

  // ── Build system prompt ─────────────────────────────────────
  const systemText = validator.systemPrompt + (validator.contextText ? `\n\nCONTEXTO ADICIONAL:\n${validator.contextText}` : "");

  const system = [
    {
      type: "text",
      text: systemText,
      cache_control: { type: "ephemeral" },
    },
  ];

  // ── Build user message ──────────────────────────────────────
  const userMessage = `TASK BRUTA ORIGINAL:\n"${rawTask}"\n\nJSON REFINADO PELO AGENTE REFINADOR:\n${JSON.stringify(refinerResult, null, 2)}\n\nIMPORTANTE: Sua resposta DEVE ser APENAS um objeto JSON válido, sem texto antes ou depois, sem markdown, sem explicações. Valide e, se necessário, corrija o JSON acima. Se precisar anotar correções, inclua-as dentro do próprio JSON nos campos "validation_status" e "validation_notes". Retorne APENAS o JSON final.`;

  const messages = [
    { role: "user", content: userMessage },
  ];

  // ── Call Claude (with JSON retry) ─────────────────────────
  const { result: validatedResult, text, response } = await callClaudeExpectingJson({
    model: validator.model || "claude-sonnet-4-20250514",
    maxTokens: validator.maxTokens || 4000,
    system,
    messages,
    stepLabel: "validator",
  });

  // Extract validation metadata from the result
  const validationStatus = validatedResult.validation_status || "approved";
  const validationNotes = validatedResult.validation_notes || [];

  // Remove validation metadata from the task result itself
  // (we store them separately in the tasks table)
  delete validatedResult.validation_status;
  delete validatedResult.validation_notes;

  // ── Save conversation ───────────────────────────────────────
  if (taskId) {
    await addConversationMessage(taskId, "user", `[Validator] Validar JSON refinado`);
    await addConversationMessage(taskId, "assistant", `[Validator] ${text}`);
  }

  // ── Track token usage ──────────────────────────────────────
  const usage = response.usage || {};
  const tokenInfo = {
    inputTokens: usage.input_tokens || 0,
    outputTokens: usage.output_tokens || 0,
    cacheCreationTokens: usage.cache_creation_input_tokens || 0,
    cacheReadTokens: usage.cache_read_input_tokens || 0,
  };

  console.log(
    `[Tokens] [validator] task=${taskId || "?"} | in=${tokenInfo.inputTokens} out=${tokenInfo.outputTokens} cache_read=${tokenInfo.cacheReadTokens} cache_write=${tokenInfo.cacheCreationTokens}`
  );
  console.log(
    `[Pipeline] task=${taskId || "?"} | validation_status=${validationStatus} | notes=${validationNotes.length} fixes`
  );

  if (taskId) {
    try {
      await saveTokenUsage(taskId, validator.id, tokenInfo, "validator");
    } catch (err) {
      console.error("[DB] Failed to save validator token usage:", err.message);
    }
  }

  return { result: validatedResult, validationStatus, validationNotes };
}

// ══════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════

async function getParentResult(taskId) {
  const task = await getTaskById(taskId);
  if (!task) return null;
  const parentId = task.parentId;
  if (!parentId) return null;
  const parent = await getTaskById(parentId);
  if (!parent || !parent.result) return null;
  return parent.result;
}

async function getRootTaskId(taskId) {
  let currentId = taskId;
  while (currentId) {
    const task = await getTaskById(currentId);
    if (!task || !task.parentId) return currentId;
    currentId = task.parentId;
  }
  return taskId;
}
