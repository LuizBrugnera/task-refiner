import { EventEmitter } from "events";
import { v4 as uuidv4 } from "uuid";
import { refineTask } from "./refiner.js";
import { saveTask } from "./database.js";

class TaskQueue extends EventEmitter {
  constructor() {
    super();
    this.jobs = new Map(); // jobId -> job
    this.processing = false;
    this.queue = []; // array of jobIds to process
    this.concurrency = 2;
    this.activeCount = 0;
  }

  add(rawTask, {
    parentId = null,
    improvementNotes = null,
    version = 1,
    agentId = null,
    pipelineMode = "simple",
    validatorAgentId = null,
  } = {}) {
    const jobId = uuidv4();
    const job = {
      id: jobId,
      rawTask,
      status: "waiting",
      result: null,
      error: null,
      version,
      parentId,
      improvementNotes,
      agentId,
      pipelineMode,
      validatorAgentId,
      validationStatus: null,
      validationNotes: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.jobs.set(jobId, job);
    this.queue.push(jobId);
    this.emit("job:added", job);
    this._processNext();
    return job;
  }

  addBatch(rawTasks, { agentId = null, pipelineMode = "simple", validatorAgentId = null } = {}) {
    return rawTasks.map((t) => this.add(t, { agentId, pipelineMode, validatorAgentId }));
  }

  getAll() {
    return Array.from(this.jobs.values()).sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );
  }

  getJob(jobId) {
    return this.jobs.get(jobId) || null;
  }

  remove(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    this.jobs.delete(jobId);
    this.queue = this.queue.filter((id) => id !== jobId);
    this.emit("job:removed", job);
    return job;
  }

  approve(jobId) {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== "review") return null;
    job.status = "approved";
    job.updatedAt = new Date().toISOString();
    this.emit("job:approved", job);
    return job;
  }

  reject(jobId, reason) {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== "review") return null;
    job.status = "rejected";
    job.rejectReason = reason || "Rejeitado pelo usuário";
    job.updatedAt = new Date().toISOString();
    this._persistToDb(job);
    this.emit("job:rejected", job);
    return job;
  }

  markPublished(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    job.status = "published";
    job.updatedAt = new Date().toISOString();
    this._persistToDb(job);
    this.emit("job:published", job);
    return job;
  }

  _updateStatus(jobId, status) {
    const job = this.jobs.get(jobId);
    if (job) {
      job.status = status;
      job.updatedAt = new Date().toISOString();
    }
    return job;
  }

  async _persistToDb(job) {
    try {
      await saveTask(job);
    } catch (err) {
      console.error(`[DB] Failed to persist job ${job.id}:`, err.message);
    }
  }

  async _processNext() {
    if (this.activeCount >= this.concurrency || this.queue.length === 0) return;

    const jobId = this.queue.shift();
    const job = this.jobs.get(jobId);
    if (!job) return this._processNext();

    this.activeCount++;
    this._updateStatus(jobId, "processing");
    this.emit("job:processing", job);

    // Persist task to DB first so conversation FK constraint is satisfied
    await this._persistToDb(job);

    // Initialize pipeline steps tracking
    job.pipelineSteps = [];

    refineTask(job.rawTask, {
      agentId: job.agentId,
      improvementNotes: job.improvementNotes,
      taskId: job.id,
      pipelineMode: job.pipelineMode || "simple",
      validatorAgentId: job.validatorAgentId || null,
      onProgress: (stepData) => {
        // Track step in the job
        const existing = job.pipelineSteps.find(s => s.step === stepData.step);
        if (existing) {
          Object.assign(existing, stepData);
        } else {
          job.pipelineSteps.push(stepData);
        }
        job.updatedAt = new Date().toISOString();
        this.emit("job:pipeline-step", job);
      },
    })
      .then(({ result, validationStatus, validationNotes }) => {
        job.result = result;
        job.validationStatus = validationStatus;
        job.validationNotes = validationNotes;
        job.status = "review";
        job.updatedAt = new Date().toISOString();
        this._persistToDb(job);
        this.emit("job:review", job);
      })
      .catch((err) => {
        job.status = "error";

        // Friendly error messages for common API errors
        const isRateLimit = err?.status === 429 || err?.error?.type === "rate_limit_error" || (err?.message && err.message.includes("rate_limit"));
        const isOverloaded = err?.status === 529 || (err?.message && err.message.includes("overloaded"));
        const isContextTooLong = err?.status === 400 && err?.message && err.message.includes("too long");

        if (isRateLimit) {
          job.error = "⏱️ Rate limit atingido — muitas requisições em pouco tempo. O sistema tentou novamente mas o limite persistiu. Aguarde ~1 min e clique em Regenerar.";
        } else if (isOverloaded) {
          job.error = "🔄 API da Anthropic sobrecarregada no momento. Tente novamente em alguns minutos.";
        } else if (isContextTooLong) {
          job.error = "📏 O contexto do agent é muito grande para o modelo. Reduza o texto de contexto ou use um modelo com janela maior.";
        } else {
          job.error = err.message;
        }

        job.updatedAt = new Date().toISOString();
        this._persistToDb(job);
        this.emit("job:error", job);
      })
      .finally(() => {
        this.activeCount--;
        this._processNext();
      });
  }

  getStats() {
    const all = this.getAll();
    return {
      total: all.length,
      waiting: all.filter((j) => j.status === "waiting").length,
      processing: all.filter((j) => j.status === "processing").length,
      review: all.filter((j) => j.status === "review").length,
      approved: all.filter((j) => j.status === "approved").length,
      published: all.filter((j) => j.status === "published").length,
      rejected: all.filter((j) => j.status === "rejected").length,
      error: all.filter((j) => j.status === "error").length,
    };
  }
}

export const taskQueue = new TaskQueue();
