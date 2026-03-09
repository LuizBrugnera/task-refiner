import { Router } from "express";
import multer from "multer";
import { taskQueue } from "./taskQueue.js";
import { publishToNotion } from "./notionPublisher.js";
import {
  getAllTasks, getTaskById, getTaskHistory, saveTask, deleteTask,
  getAllAgents, getAgentById, createAgent, updateAgent, deleteAgent, setDefaultAgent, getDefaultAgent,
  addAgentImage, getAgentImages, getAgentImageData, deleteAgentImage,
  addTaskImage, getTaskImages, getTaskImageData,
  getConversationByTaskId, getConversationChain,
  getTokenUsageStats,
  getAgentFeedbackExamples,
} from "./database.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB max

// ══════════════════════════════════════════════════════════════
// AGENTS
// ══════════════════════════════════════════════════════════════

// GET /api/agents — list all agents
router.get("/agents", async (req, res) => {
  try {
    const agents = await getAllAgents();
    res.json(agents);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch agents", detail: err.message });
  }
});

// GET /api/agents/default — get default agent
router.get("/agents/default", async (req, res) => {
  try {
    const agent = await getDefaultAgent();
    res.json(agent);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch default agent", detail: err.message });
  }
});

// GET /api/agents/:id — get one agent
router.get("/agents/:id", async (req, res) => {
  try {
    const agent = await getAgentById(req.params.id);
    if (!agent) return res.status(404).json({ error: "Agent not found" });
    res.json(agent);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch agent", detail: err.message });
  }
});

// POST /api/agents — create a new agent
router.post("/agents", async (req, res) => {
  try {
    const { name, description, icon, systemPrompt, contextText, outputFormat, model, maxTokens } = req.body;
    if (!name || !systemPrompt) {
      return res.status(400).json({ error: "name and systemPrompt are required" });
    }
    const agent = await createAgent({ name, description, icon, systemPrompt, contextText, outputFormat, model, maxTokens });
    res.status(201).json(agent);
  } catch (err) {
    res.status(500).json({ error: "Failed to create agent", detail: err.message });
  }
});

// PUT /api/agents/:id — update an agent
router.put("/agents/:id", async (req, res) => {
  try {
    const { name, description, icon, systemPrompt, contextText, outputFormat, model, maxTokens } = req.body;
    if (!name || !systemPrompt) {
      return res.status(400).json({ error: "name and systemPrompt are required" });
    }
    const agent = await updateAgent(req.params.id, { name, description, icon, systemPrompt, contextText, outputFormat, model, maxTokens });
    res.json(agent);
  } catch (err) {
    res.status(500).json({ error: "Failed to update agent", detail: err.message });
  }
});

// DELETE /api/agents/:id
router.delete("/agents/:id", async (req, res) => {
  try {
    await deleteAgent(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/agents/:id/default — set as default agent
router.post("/agents/:id/default", async (req, res) => {
  try {
    await setDefaultAgent(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to set default", detail: err.message });
  }
});

// GET /api/agents/:id/feedback — get feedback stats and examples for an agent
router.get("/agents/:id/feedback", async (req, res) => {
  try {
    const feedback = await getAgentFeedbackExamples(req.params.id, {
      maxApproved: parseInt(req.query.maxApproved) || 5,
      maxRejected: parseInt(req.query.maxRejected) || 5,
    });
    res.json({
      approvedCount: feedback.approvedCount,
      rejectedCount: feedback.rejectedCount,
      approved: feedback.approved,
      rejected: feedback.rejected,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch feedback", detail: err.message });
  }
});

// ── Agent Images ─────────────────────────────────────────
// POST /api/agents/:id/images — upload image
router.post("/agents/:id/images", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No image provided" });
    const result = await addAgentImage(req.params.id, req.file.originalname, req.file.mimetype, req.file.buffer);
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: "Failed to upload image", detail: err.message });
  }
});

// GET /api/agents/:id/images — list images
router.get("/agents/:id/images", async (req, res) => {
  try {
    const images = await getAgentImages(req.params.id);
    res.json(images);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch images", detail: err.message });
  }
});

// GET /api/images/:imageId — serve image
router.get("/images/:imageId", async (req, res) => {
  try {
    const img = await getAgentImageData(req.params.imageId);
    if (!img) return res.status(404).json({ error: "Image not found" });
    res.set("Content-Type", img.mimeType);
    res.set("Content-Disposition", `inline; filename="${img.filename}"`);
    res.send(img.data);
  } catch (err) {
    res.status(500).json({ error: "Failed to serve image", detail: err.message });
  }
});

// DELETE /api/images/:imageId
router.delete("/images/:imageId", async (req, res) => {
  try {
    await deleteAgentImage(req.params.imageId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete image", detail: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// QUEUE ROUTES (in-memory processing)
// ══════════════════════════════════════════════════════════════

// POST /api/tasks — add one or many tasks to the queue (text only, batch)
router.post("/tasks", (req, res) => {
  const { tasks, agentId, pipelineMode, validatorAgentId } = req.body;
  if (!tasks || !Array.isArray(tasks) || tasks.length === 0) {
    return res.status(400).json({ error: "Provide a non-empty array of tasks" });
  }
  const jobs = taskQueue.addBatch(tasks, {
    agentId: agentId || null,
    pipelineMode: pipelineMode || "simple",
    validatorAgentId: validatorAgentId || null,
  });
  res.status(202).json({ queued: jobs.length, jobs });
});

// POST /api/tasks/with-images — add a single task with attached images
router.post("/tasks/with-images", upload.array("images", 10), async (req, res) => {
  try {
    const { task, agentId, pipelineMode, validatorAgentId } = req.body;
    if (!task || !task.trim()) {
      return res.status(400).json({ error: "Provide a task description" });
    }

    // Create the job first (so we have the taskId)
    const job = taskQueue.add(task.trim(), {
      agentId: agentId || null,
      pipelineMode: pipelineMode || "simple",
      validatorAgentId: validatorAgentId || null,
    });

    // Save uploaded images linked to this task
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        await addTaskImage(job.id, file.originalname, file.mimetype, file.buffer);
      }
      job.hasImages = true;
      job.imageCount = req.files.length;
    }

    res.status(202).json({ queued: 1, jobs: [job] });
  } catch (err) {
    res.status(500).json({ error: "Failed to queue task", detail: err.message });
  }
});

// GET /api/task-images/:imageId — serve a task image
router.get("/task-images/:imageId", async (req, res) => {
  try {
    const img = await getTaskImageData(req.params.imageId);
    if (!img) return res.status(404).json({ error: "Image not found" });
    res.set("Content-Type", img.mimeType);
    res.set("Content-Disposition", `inline; filename="${img.filename}"`);
    res.send(img.data);
  } catch (err) {
    res.status(500).json({ error: "Failed to serve image", detail: err.message });
  }
});

// GET /api/tasks/:id/images — list images for a task
router.get("/tasks/:id/images", async (req, res) => {
  try {
    const images = await getTaskImages(req.params.id);
    res.json(images);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch task images", detail: err.message });
  }
});

// GET /api/tasks — list all jobs in the current queue
router.get("/tasks", (req, res) => {
  res.json(taskQueue.getAll());
});

// GET /api/tasks/stats
router.get("/tasks/stats", (req, res) => {
  res.json(taskQueue.getStats());
});

// GET /api/tokens/stats — token usage monitoring
router.get("/tokens/stats", async (req, res) => {
  try {
    const stats = await getTokenUsageStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch token stats", detail: err.message });
  }
});

// GET /api/tasks/:id
router.get("/tasks/:id", (req, res) => {
  const job = taskQueue.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json(job);
});

// POST /api/tasks/:id/approve — approve and save to DB
router.post("/tasks/:id/approve", async (req, res) => {
  const job = taskQueue.approve(req.params.id);
  if (!job) return res.status(400).json({ error: "Job not in review state" });

  try {
    job.status = "published";
    job.updatedAt = new Date().toISOString();
    await saveTask(job);
    taskQueue.markPublished(job.id);

    let notionUrl = null;
    try {
      const publishResult = await publishToNotion(job);
      if (publishResult && publishResult.url) {
        notionUrl = publishResult.url;
      }
    } catch {
      // Notion is optional
    }

      res.json({
        success: true,
      savedTo: "database",
      notionUrl,
        job: taskQueue.getJob(job.id),
      });
  } catch (err) {
    res.status(500).json({ error: "Failed to save", detail: err.message });
  }
});

// POST /api/tasks/:id/reject
router.post("/tasks/:id/reject", (req, res) => {
  const { reason } = req.body;
  const job = taskQueue.reject(req.params.id, reason);
  if (!job) return res.status(400).json({ error: "Job not in review state" });
  res.json(job);
});

// POST /api/tasks/:id/retry — retry a failed job in the queue
router.post("/tasks/:id/retry", (req, res) => {
  const oldJob = taskQueue.getJob(req.params.id);
  if (!oldJob) return res.status(404).json({ error: "Job not found" });
  if (oldJob.status !== "error") return res.status(400).json({ error: "Job is not in error state" });

  // Remove old job and re-add
  taskQueue.remove(req.params.id);
  const newJob = taskQueue.add(oldJob.rawTask, {
    parentId: oldJob.parentId || null,
    improvementNotes: oldJob.improvementNotes || null,
    version: oldJob.version || 1,
    agentId: oldJob.agentId || null,
    pipelineMode: oldJob.pipelineMode || "simple",
    validatorAgentId: oldJob.validatorAgentId || null,
  });
  res.json({ success: true, oldJobId: req.params.id, newJob });
});

// DELETE /api/tasks/:id — remove a job from the queue
router.delete("/tasks/:id", (req, res) => {
  const job = taskQueue.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found" });
  taskQueue.remove(req.params.id);
  res.json({ success: true });
});

// SSE endpoint for real-time updates
router.get("/tasks/stream/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  send("init", taskQueue.getAll());

  const handlers = {
    "job:added": (j) => send("job:added", j),
    "job:processing": (j) => send("job:processing", j),
    "job:pipeline-step": (j) => send("job:pipeline-step", j),
    "job:review": (j) => send("job:review", j),
    "job:approved": (j) => send("job:approved", j),
    "job:rejected": (j) => send("job:rejected", j),
    "job:published": (j) => send("job:published", j),
    "job:error": (j) => send("job:error", j),
    "job:removed": (j) => send("job:removed", j),
  };

  Object.entries(handlers).forEach(([event, fn]) => taskQueue.on(event, fn));

  req.on("close", () => {
    Object.entries(handlers).forEach(([event, fn]) => taskQueue.off(event, fn));
  });
});

// ══════════════════════════════════════════════════════════════
// DATABASE ROUTES (persistent storage)
// ══════════════════════════════════════════════════════════════

// GET /api/db/tasks
router.get("/db/tasks", async (req, res) => {
  try {
    const { page = 1, limit = 50, status, search } = req.query;
    const result = await getAllTasks({
      page: parseInt(page),
      limit: parseInt(limit),
      status: status || null,
      search: search || null,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch tasks", detail: err.message });
  }
});

// GET /api/db/tasks/:id
router.get("/db/tasks/:id", async (req, res) => {
  try {
    const task = await getTaskById(req.params.id);
    if (!task) return res.status(404).json({ error: "Task not found" });
    res.json(task);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch task", detail: err.message });
  }
});

// GET /api/db/tasks/:id/history
router.get("/db/tasks/:id/history", async (req, res) => {
  try {
    const history = await getTaskHistory(req.params.id);
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch history", detail: err.message });
  }
});

// GET /api/db/tasks/:id/conversation — conversation history
router.get("/db/tasks/:id/conversation", async (req, res) => {
  try {
    const conversation = await getConversationChain(req.params.id);
    res.json(conversation);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch conversation", detail: err.message });
  }
});

// POST /api/db/tasks/:id/re-refine
router.post("/db/tasks/:id/re-refine", async (req, res) => {
  try {
    const { improvementNotes, agentId, pipelineMode, validatorAgentId } = req.body;
    if (!improvementNotes || !improvementNotes.trim()) {
      return res.status(400).json({ error: "Provide improvement notes" });
    }

    const originalTask = await getTaskById(req.params.id);
    if (!originalTask) return res.status(404).json({ error: "Task not found" });

    const job = taskQueue.add(originalTask.rawTask, {
      parentId: originalTask.id,
      improvementNotes: improvementNotes.trim(),
      version: (originalTask.version || 1) + 1,
      agentId: agentId || originalTask.agentId || null,
      pipelineMode: pipelineMode || originalTask.pipelineMode || "simple",
      validatorAgentId: validatorAgentId || originalTask.validatorAgentId || null,
    });

    res.status(202).json({
      success: true,
      message: "Task queued for re-refinement",
      job,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to re-refine", detail: err.message });
  }
});

// POST /api/db/tasks/:id/retry — retry a failed task from DB
router.post("/db/tasks/:id/retry", async (req, res) => {
  try {
    const task = await getTaskById(req.params.id);
    if (!task) return res.status(404).json({ error: "Task not found" });
    if (task.status !== "error") return res.status(400).json({ error: "Task is not in error state" });

    const { agentId } = req.body || {};

    // Re-queue the same raw task (same version, replaces the failed attempt)
    const job = taskQueue.add(task.rawTask, {
      parentId: task.parentId || null,
      improvementNotes: task.improvementNotes || null,
      version: task.version || 1,
      agentId: agentId || task.agentId || null,
      pipelineMode: task.pipelineMode || "simple",
      validatorAgentId: task.validatorAgentId || null,
    });

    // Delete the old failed task from DB
    await deleteTask(req.params.id);

    res.status(202).json({
      success: true,
      message: "Failed task re-queued for processing",
      job,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to retry task", detail: err.message });
  }
});

// DELETE /api/db/tasks/:id
router.delete("/db/tasks/:id", async (req, res) => {
  try {
    await deleteTask(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete task", detail: err.message });
  }
});

export default router;
