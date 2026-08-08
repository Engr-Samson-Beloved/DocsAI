/**
 * chatPlanner.ts
 * ------------------------------------------------------------------
 * Stage 2 of the chat upgrade: a lightweight, provider-agnostic
 * tool-calling planner. Instead of matching the user's message against
 * regex keyword rules, we describe the app's real capabilities ("tools")
 * to the LLM and ask it to return a single structured action:
 *
 *     { "tool": "<name>", "args": { ... }, "say": "<short reply>" }
 *
 * The client dispatcher (in MobileChatView) executes the returned tool by
 * calling the corresponding app callback — so ANY natural-language phrasing
 * ("make my conclusion sound human", "put chapter 3 before 2", "give it
 * double spacing and Times New Roman", "export a word doc", "cite some
 * papers on X") maps to a real feature, with the document outline and
 * conversation as context.
 *
 * If the planner is unavailable or unsure, callers fall back to the Stage 1
 * keyword classifier (classifyIntent), so chat always works.
 */

import type { ConversationMessage, DocumentMetadata } from './chatIntelligence'
import { buildDocumentOutline } from './chatIntelligence'

export type ToolName =
  | 'write_or_edit'
  | 'remove_section'
  | 'move_section'
  | 'format_document'
  | 'apply_cover_page'
  | 'search_journals'
  | 'generate_full_document'
  | 'export_document'
  | 'undo'
  | 'redo'
  | 'apply_changes'
  | 'discard_changes'
  | 'answer_question'
  | 'chat'

export interface ToolCall {
  tool: ToolName
  args: Record<string, unknown>
  /** short, friendly message to show in the chat thread */
  say: string
}

/** Human-readable manifest injected into the planner prompt. */
const TOOL_MANIFEST = `
- write_or_edit: Generate NEW content or edit/rewrite/humanize/paraphrase/expand/shorten/summarize EXISTING content. args: { section?: string (e.g. "Chapter 3", "conclusion", "abstract" — omit for the whole doc or current focus), instruction: string (exactly what to write or how to change it, in detail) }
- remove_section: Delete a section/chapter. args: { section: string }
- move_section: Reorder a section. args: { section: string, position: string (e.g. "before Chapter 2", "to the end") }
- format_document: Change typography of the WHOLE document. args: { font?: "Times New Roman"|"Arial"|"Georgia"|"Courier"|"default", spacing?: "single"|"1.5"|"double" }
- apply_cover_page: Create/replace the front/title/cover page. args: { studentName?, matricNo?, department?, faculty?, institution?, supervisorName?, title?, academicSession?, submissionDate? } (include whatever the user provided; empty is fine)
- search_journals: Find REAL academic references/citations online. args: { query: string (the topic to find papers about) }
- generate_full_document: Generate the entire multi-chapter document from scratch. args: {}
- export_document: Download the document. args: { format: "pdf"|"word"|"powerpoint" }
- undo: Undo the last change. args: {}
- redo: Redo the last undone change. args: {}
- apply_changes: Insert/accept the AI content that is currently pending. args: {}
- discard_changes: Discard the pending AI content. args: {}
- answer_question: Answer a question ABOUT the document or a general question, without changing the document. args: { question: string }
- chat: Greeting/small talk/unclear — just reply, no action. args: {}
`.trim()

/**
 * Build the planner prompt. The model must reply with a single JSON object.
 */
export function buildPlannerPrompt(
  message: string,
  history: ConversationMessage[],
  metadata: DocumentMetadata
): string {
  const outline = buildDocumentOutline(metadata.editorHtml || '')
  const recent = history
    .filter((m) => m.role !== 'system' && m.content.trim())
    .slice(-6)
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, 240)}`)
    .join('\n')

  return `You are the ACTION ROUTER for "WordPI", an academic document writing app. Decide which single tool best fulfils the user's latest message, and extract its arguments. Use the document outline and conversation for context (e.g. resolve "it", "that part", "the last chapter").

AVAILABLE TOOLS:
${TOOL_MANIFEST}

DOCUMENT CONTEXT:
- Title: ${metadata.title || 'Untitled'}
- Type: ${metadata.documentType}, Level: ${metadata.academicLevel}
- ${metadata.wordCount} words, ${metadata.totalPages} page(s)
- Outline:
${outline}

${recent ? `RECENT CONVERSATION:\n${recent}\n` : ''}
USER MESSAGE: "${message}"

Respond with ONLY a valid JSON object, no markdown, no code fences, in this exact shape:
{"tool": "<one tool name>", "args": { ... }, "say": "<one short friendly sentence telling the user what you're doing>"}

Rules:
- Choose exactly ONE tool. Prefer a concrete action over "chat" whenever the user asks for something doable.
- For any writing/editing/humanizing/rephrasing/expanding request, use write_or_edit and put the FULL detailed instruction in args.instruction (include the target section if named).
- Only use search_journals when the user wants REAL external references/citations found; use write_or_edit to write a references SECTION.
- Keep "say" short (max ~15 words). Do not include the JSON anywhere in "say".`
}

/** Robustly extract the first JSON object from a model response. */
export function parseToolCall(raw: string): ToolCall | null {
  if (!raw) return null
  let text = raw.trim()
  // Strip code fences if present.
  text = text.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  const slice = text.slice(start, end + 1)
  try {
    const obj = JSON.parse(slice)
    if (!obj || typeof obj.tool !== 'string') return null
    return {
      tool: obj.tool as ToolName,
      args: obj.args && typeof obj.args === 'object' ? obj.args : {},
      say: typeof obj.say === 'string' ? obj.say : '',
    }
  } catch {
    return null
  }
}

/**
 * Ask the server planner for a tool call. Returns null on any failure so
 * the caller can fall back to the keyword classifier.
 */
export async function planChatAction(
  message: string,
  history: ConversationMessage[],
  metadata: DocumentMetadata
): Promise<ToolCall | null> {
  try {
    const prompt = buildPlannerPrompt(message, history, metadata)
    const res = await fetch('/api/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    })
    if (!res.ok) return null
    const data = await res.json()
    return parseToolCall(data?.text || '')
  } catch {
    return null
  }
}
