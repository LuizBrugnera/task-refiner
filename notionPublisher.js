import { Client } from "@notionhq/client";

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DATABASE_ID = process.env.NOTION_DATABASE_ID;

const notionEnabled = !!(NOTION_TOKEN && DATABASE_ID);
const notion = notionEnabled ? new Client({ auth: NOTION_TOKEN }) : null;

/**
 * Publishes a refined task to Notion (if configured).
 * Database (MySQL) is now the primary storage — Notion is optional.
 */
export async function publishToNotion(job) {
  if (!notionEnabled) return null;
    return _publishToNotionAPI(job);
}

// ---- Notion publishing ----

async function _publishToNotionAPI(job) {
  const { result } = job;

  const effortColors = { P: "green", M: "blue", G: "yellow", GG: "red" };

  const children = [
    heading("📋 Descrição"),
    paragraph(result.description),

    heading("✅ Critérios de Aceite"),
    ...result.acceptance_criteria.map((ac) =>
      bulletItem(
        `**Given** ${ac.given} → **When** ${ac.when} → **Then** ${ac.then}`
      )
    ),

    heading("🔧 Subtasks"),
    ...result.subtasks.map((s) => bulletItem(`**${s.title}** — ${s.description}`)),

    heading("⚠️ Riscos"),
    ...result.risks.map((r) => bulletItem(r)),

    heading("🔗 Dependências"),
    ...result.dependencies.map((d) => bulletItem(d)),
  ];

  const page = await notion.pages.create({
    parent: { database_id: DATABASE_ID },
    properties: {
      Name: {
        title: [{ text: { content: result.title } }],
      },
      Status: {
        select: { name: "Backlog" },
      },
      Effort: {
        select: {
          name: result.effort,
          color: effortColors[result.effort] || "default",
        },
      },
      Points: {
        number: result.effort_points,
      },
      Epic: {
        rich_text: [{ text: { content: result.epic || "" } }],
      },
      Labels: {
        multi_select: result.labels.map((l) => ({ name: l })),
      },
      "Assignee Role": {
        select: { name: result.suggested_assignee_role },
      },
    },
    children,
  });

  return page;
}

// ---- Notion block helpers ----

function heading(text) {
  return {
    object: "block",
    type: "heading_2",
    heading_2: {
      rich_text: [{ type: "text", text: { content: text } }],
    },
  };
}

function paragraph(text) {
  return {
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: [{ type: "text", text: { content: text } }],
    },
  };
}

function bulletItem(text) {
  return {
    object: "block",
    type: "bulleted_list_item",
    bulleted_list_item: {
      rich_text: [{ type: "text", text: { content: text } }],
    },
  };
}
