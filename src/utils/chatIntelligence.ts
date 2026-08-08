/**
 * WordPI Chat Intelligence Engine
 * ─────────────────────────────────────────────────────────────────
 * Client-side intent classification, conversation memory injection,
 * section-aware context extraction, and smart action routing for
 * the mobile chat interface.
 */

// ─── Intent Types ──────────────────────────────────────────────
export type ChatIntent =
  | 'cover-page'
  | 'journal-search'
  | 'humanize'
  | 'rephrase'
  | 'intro'
  | 'outline'
  | 'blueprint'
  | 'generate-section'
  | 'edit-section'
  | 'question'
  | 'export'
  | 'greeting'
  | 'format'
  | 'custom'

export interface ClassifiedIntent {
  action: ChatIntent
  targetSection?: string        // e.g. "Chapter 3", "conclusion", "abstract"
  targetPage?: number           // e.g. page 2
  originalMessage: string
  enrichedPrompt: string        // The final prompt sent to the AI
  requiresSelection: boolean    // Whether this action normally needs highlighted text
  skipSelection: boolean        // Whether we override the selection requirement for mobile
}

export interface ConversationMessage {
  role: 'user' | 'ai' | 'system'
  content: string
}

export interface DocumentMetadata {
  title: string
  documentType: 'Seminar' | 'Proposal' | 'Project' | 'Custom'
  academicLevel: string
  wordCount: number
  totalPages: number
  editorHtml: string
}

// ─── Intent Classification Rules ───────────────────────────────
interface IntentRule {
  intent: ChatIntent
  patterns: RegExp[]
  priority: number // Higher = checked first
}

const INTENT_RULES: IntentRule[] = [
  // Greeting
  {
    intent: 'greeting' as ChatIntent,
    patterns: [
      /^(hi|hello|hey|good\s*(morning|afternoon|evening|day)|howdy|yo|sup|what'?s\s*up)[!.,?\s]*$/i,
      /^(help|help\s*me|what\s*can\s*you\s*do|how\s*does\s*this\s*work|how\s*do\s*i\s*use|get\s*started|start)[!?,\s]*$/i,
      /^(thanks|thank\s*you|ok|okay|cool|nice|great|awesome|perfect|got\s*it|alright)[!.,?\s]*$/i,
    ],
    priority: 95
  },
  // Export / Download
  {
    intent: 'export',
    patterns: [
      /\b(export|download|save\s+as|get\s+the\s+file|docx|pdf|pptx)\b/i
    ],
    priority: 100
  },
  // Front cover page
  {
    intent: 'cover-page',
    patterns: [
      /\b(generate|create|build|set\s*up|make|add|edit|design|do)\s+(a\s+|an\s+|the\s+|my\s+|our\s+)?(front\s*page|cover\s*page|title\s*page|frontpage|front\s*cover|cover)\b/i,
      /\b(front\s*page|cover\s*page|title\s*page|front\s*cover)\s*(form|details|setup)?\b/i
    ],
    priority: 95
  },
  // Online journal search
  {
    intent: 'journal-search',
    patterns: [
      /\b(search|find|get|look\s*up|fetch)\s+(journals?|references?|papers?|articles?|citations?|sources?)\s*(online)?\b/i,
      /\b(online\s+journals?|academic\s+papers?|cite\s+journals?)\b/i
    ],
    priority: 95
  },
  // Humanize
  {
    intent: 'humanize',
    patterns: [
      /\b(humanize|human[\s-]?written|bypass\s+ai|ai\s+detect|turnitin|gptzero|make\s+it\s+(sound|look|feel)\s+human|anti[\s-]?ai|pass\s+(ai|detection))\b/i
    ],
    priority: 90
  },
  // Rephrase / Rewrite
  {
    intent: 'rephrase',
    patterns: [
      /\b(rephrase|rewrite|reword|paraphrase|rework|restructure\s+(the\s+)?(sentence|paragraph|text|section|writing))\b/i
    ],
    priority: 85
  },
  // Introduction generation
  {
    intent: 'intro',
    patterns: [
      /\b(generate|write|create|draft)\s+(an?\s+)?(introduction|intro|chapter\s*1|opening\s+section)\b/i,
      /\b(introduction|intro|chapter\s*1)\s+(section|chapter)?\s*(generation|generator)?\b/i
    ],
    priority: 80
  },
  // Full outline
  {
    intent: 'outline',
    patterns: [
      /\b(generate|create|write|draft|build)\s+(an?\s+)?(outline|table\s+of\s+contents|toc|structure|skeleton)\b/i,
      /\b(thesis|project|document)\s+outline\b/i
    ],
    priority: 80
  },
  // Full blueprint
  {
    intent: 'blueprint',
    patterns: [
      /\b(generate|create|build)\s+(the\s+)?(full|entire|complete|whole)\s+(document|project|report|thesis|blueprint)\b/i,
      /\b(blueprint|full\s+document|generate\s+everything)\b/i
    ],
    priority: 75
  },
  // Document formatting / styling
  {
    intent: 'format',
    patterns: [
      /\b(format|style|typography|font|line\s*spacing|reformat|layout)\s+(the\s+)?(document|text|content|report|paper|page)?\b/i,
      /\b(format\s+my\s+document|apply\s+formatting|just\s+format)\b/i
    ],
    priority: 85
  },
  // Edit a specific section
  {
    intent: 'edit-section',
    patterns: [
      /\b(edit|update|change|modify|fix|correct|improve|enhance|expand|shorten|revise)\s+(the\s+)?(chapter|section|page|paragraph|intro|introduction|conclusion|abstract|background|literature|methodology|results?|discussion|recommendation|reference|bibliography|appendix)/i,
      /\b(chapter|section)\s*\d+/i
    ],
    priority: 70
  },
  // Generate a specific section
  {
    intent: 'generate-section',
    patterns: [
      /\b(generate|write|create|draft|add)\s+(a\s+|the\s+)?(chapter|section|paragraph|conclusion|abstract|background|literature\s+review|methodology|results?|discussion|recommendation|reference|bibliography|appendix)/i,
      /\b(write|generate|create)\s+(about|on|for)\b/i
    ],
    priority: 60
  },
  // Questions about the document
  {
    intent: 'question',
    patterns: [
      /^(what|how|why|when|where|who|which|can\s+you|could\s+you|is\s+there|are\s+there|do\s+you|does|did|will|would|should|explain|tell\s+me|describe)\b/i,
      /\?$/
    ],
    priority: 50
  }
]

// ─── Section Extraction Patterns ───────────────────────────────
const SECTION_PATTERNS = [
  /(?:chapter|chap\.?)\s*(\d+)/i,
  /(?:section|sec\.?)\s*(\d+(?:\.\d+)?)/i,
  /(?:page|pg\.?|p\.?)\s*(\d+)/i,
  /\b(introduction|intro|abstract|background|literature\s+review|methodology|method|results?|findings?|discussion|conclusion|recommendation|reference|bibliography|appendix)\b/i
]

export function extractSectionTarget(message: string): { section?: string; page?: number } {
  for (const pattern of SECTION_PATTERNS) {
    const match = message.match(pattern)
    if (match) {
      // Check if it's a page number pattern
      if (/page|pg|p\./i.test(pattern.source)) {
        return { page: parseInt(match[1]) }
      }
      // Chapter/Section number
      if (/chapter|chap|section|sec/i.test(pattern.source)) {
        return { section: `Chapter ${match[1]}` }
      }
      // Named section
      return { section: match[1] }
    }
  }
  return {}
}

// ─── Extract relevant document section from HTML ───────────────
export function extractSectionFromHtml(html: string, sectionTarget: string): string {
  if (!html || !sectionTarget) return ''

  const target = sectionTarget.toLowerCase().trim()
  const headingRegex = /<h([1-6])[^>]*>(.*?)<\/h\1>/gi
  const headings: { level: number; text: string; index: number }[] = []
  let match

  while ((match = headingRegex.exec(html)) !== null) {
    const level = parseInt(match[1], 10)
    const cleanText = match[2].replace(/<[^>]*>/g, '').trim()
    headings.push({ level, text: cleanText, index: match.index })
  }

  if (headings.length === 0) return ''

  // Find the best matching heading
  let bestIdx = -1
  for (let i = 0; i < headings.length; i++) {
    const hText = headings[i].text.toLowerCase()
    if (
      hText.includes(target) ||
      target.includes(hText) ||
      (target.match(/chapter\s*(\d+)/i) && hText.match(/chapter\s*(\d+)/i) &&
        target.match(/chapter\s*(\d+)/i)![1] === hText.match(/chapter\s*(\d+)/i)![1])
    ) {
      bestIdx = i
      break
    }
  }

  if (bestIdx === -1) return ''

  const startIdx = headings[bestIdx].index
  const matchedLevel = headings[bestIdx].level

  // Find next heading of equal or higher rank (level <= matchedLevel)
  let endIdx = html.length
  for (let i = bestIdx + 1; i < headings.length; i++) {
    if (headings[i].level <= matchedLevel) {
      endIdx = headings[i].index
      break
    }
  }

  const sectionHtml = html.slice(startIdx, Math.min(endIdx, startIdx + 8000))
  return sectionHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

// ─── Replace a section in HTML in-place ─────────────────────────
export function replaceSectionInHtml(fullHtml: string, sectionTarget: string, newSectionHtml: string): string {
  if (!fullHtml || !sectionTarget || !newSectionHtml) return fullHtml

  const target = sectionTarget.toLowerCase().trim()
  const headingRegex = /<h([1-6])[^>]*>(.*?)<\/h\1>/gi
  const headings: { level: number; text: string; index: number }[] = []
  let match

  while ((match = headingRegex.exec(fullHtml)) !== null) {
    const level = parseInt(match[1], 10)
    const cleanText = match[2].replace(/<[^>]*>/g, '').trim()
    headings.push({ level, text: cleanText, index: match.index })
  }

  if (headings.length === 0) return fullHtml

  // Find best matching heading
  let bestIdx = -1
  for (let i = 0; i < headings.length; i++) {
    const hText = headings[i].text.toLowerCase()
    if (
      hText.includes(target) ||
      target.includes(hText) ||
      (target.match(/chapter\s*(\d+)/i) && hText.match(/chapter\s*(\d+)/i) &&
        target.match(/chapter\s*(\d+)/i)![1] === hText.match(/chapter\s*(\d+)/i)![1])
    ) {
      bestIdx = i
      break
    }
  }

  if (bestIdx === -1) return fullHtml

  const startIdx = headings[bestIdx].index
  const matchedLevel = headings[bestIdx].level

  // Find next heading of equal or higher rank
  let endIdx = fullHtml.length
  for (let i = bestIdx + 1; i < headings.length; i++) {
    if (headings[i].level <= matchedLevel) {
      endIdx = headings[i].index
      break
    }
  }

  const before = fullHtml.slice(0, startIdx)
  const after = fullHtml.slice(endIdx)
  return before + newSectionHtml.trim() + '\n' + after
}

// ─── Build Conversation Context String ─────────────────────────
function buildConversationContext(
  history: ConversationMessage[],
  maxMessages: number = 6
): string {
  const recent = history
    .filter(m => m.role !== 'system' && m.content.trim())
    .slice(-maxMessages)

  if (recent.length === 0) return ''

  const lines = recent.map(m => {
    const role = m.role === 'user' ? 'User' : 'WordPI'
    // Truncate long AI responses in history to save tokens
    const content = m.content.length > 300
      ? m.content.slice(0, 300) + '...'
      : m.content
    return `${role}: ${content}`
  })

  return `Previous Conversation:\n"""\n${lines.join('\n')}\n"""\n\n`
}

// ─── Main Intent Classifier ────────────────────────────────────
export function classifyIntent(
  message: string,
  conversationHistory: ConversationMessage[],
  metadata: DocumentMetadata
): ClassifiedIntent {
  const trimmed = message.trim()

  // Sort rules by priority (highest first)
  const sortedRules = [...INTENT_RULES].sort((a, b) => b.priority - a.priority)

  let matchedIntent: ChatIntent = 'custom'
  for (const rule of sortedRules) {
    if (rule.patterns.some(p => p.test(trimmed))) {
      matchedIntent = rule.intent
      break
    }
  }

  // Extract section/page targets
  const { section, page } = extractSectionTarget(trimmed)

  // Build the enriched prompt based on intent
  const conversationCtx = buildConversationContext(conversationHistory)
  const docMeta = `Document: "${metadata.title}" | Type: ${metadata.documentType} | Level: ${metadata.academicLevel} | ${metadata.wordCount} words, ${metadata.totalPages} pages`

  let enrichedPrompt = ''
  let requiresSelection = false
  let skipSelection = false

  switch (matchedIntent) {
    case 'export':
      enrichedPrompt = trimmed
      break

    case 'humanize': {
      requiresSelection = true
      skipSelection = true // On mobile, we don't have text selection, so we target a section
      const sectionCtx = section
        ? extractSectionFromHtml(metadata.editorHtml, section)
        : ''

      if (sectionCtx) {
        enrichedPrompt =
          `You are a professional academic copyeditor specializing in bypassing AI detection. ` +
          `The user wants to humanize the following section from their document.\n\n` +
          `${docMeta}\n\n` +
          `${conversationCtx}` +
          `User request: "${trimmed}"\n\n` +
          `Section content to humanize:\n"""\n${sectionCtx.slice(0, 3000)}\n"""\n\n` +
          `Rewrite it to look 100% human-written. Follow strict anti-AI-detection rules: ` +
          `vary sentence lengths aggressively, eliminate robotic transitions, use natural academic vocabulary. ` +
          `Return the rewritten content in clean HTML (<p>, <h2>, <h3> tags).`
      } else {
        enrichedPrompt =
          `You are a professional academic copyeditor. ` +
          `The user wants to humanize content in their document but didn't specify which section.\n\n` +
          `${docMeta}\n\n` +
          `${conversationCtx}` +
          `User request: "${trimmed}"\n\n` +
          `Ask the user which section or chapter they'd like you to humanize, or provide the text they want rewritten. ` +
          `List the available sections based on the document type (${metadata.documentType}).`
      }
      break
    }

    case 'rephrase': {
      requiresSelection = true
      skipSelection = true
      const sectionCtx = section
        ? extractSectionFromHtml(metadata.editorHtml, section)
        : ''

      if (sectionCtx) {
        enrichedPrompt =
          `Rephrase and polish the following section to sound highly academic, formal, and authoritative.\n\n` +
          `${docMeta}\n\n` +
          `${conversationCtx}` +
          `User request: "${trimmed}"\n\n` +
          `Section content to rephrase:\n"""\n${sectionCtx.slice(0, 3000)}\n"""\n\n` +
          `Return the rephrased content in clean HTML.`
      } else {
        enrichedPrompt =
          `The user wants to rephrase content in their document.\n\n` +
          `${docMeta}\n\n` +
          `${conversationCtx}` +
          `User request: "${trimmed}"\n\n` +
          `Ask the user which section they want rephrased.`
      }
      break
    }

    case 'intro':
      enrichedPrompt =
        `Generate a comprehensive, robust Chapter 1 (Introduction) for this ${metadata.documentType} document on topic "${metadata.title}".\n\n` +
        `${docMeta}\n\n` +
        `${conversationCtx}` +
        `User request: "${trimmed}"\n\n` +
        `Requirements:\n` +
        `- Write an extensive, 1200-2000 word Chapter 1.\n` +
        `- Include 1.1 Background of the Study, 1.2 Problem Statement, 1.3 Objectives, 1.4 Research Questions, and 1.5 Significance of the Study.\n` +
        `- Return formatted HTML with <h2>, <h3>, <p>, <ul>/<li> tags.`
      break

    case 'outline':
      enrichedPrompt =
        `Generate a comprehensive academic thesis outline for this ${metadata.documentType} document.\n\n` +
        `${docMeta}\n\n` +
        `${conversationCtx}` +
        `User request: "${trimmed}"\n\n` +
        `Structure it with chapters and subheadings. Return in HTML with <h2>, <h3>, and <ul>/<li> tags.`
      break

    case 'blueprint':
      enrichedPrompt = trimmed
      break

    case 'edit-section': {
      const sectionCtx = section
        ? extractSectionFromHtml(metadata.editorHtml, section)
        : ''

      if (sectionCtx) {
        enrichedPrompt =
          `You are an expert academic research writer. The user wants to expand and make a specific section of their ${metadata.documentType} document thoroughly robust and comprehensive.\n\n` +
          `${docMeta}\n\n` +
          `${conversationCtx}` +
          `User request: "${trimmed}"\n\n` +
          `CURRENT SECTION CONTENT TO EXPAND:\n"""\n${sectionCtx.slice(0, 6000)}\n"""\n\n` +
          `REQUIREMENTS:\n` +
          `- Produce a robust, highly detailed academic section (aim for 1500–2500 words of rich content).\n` +
          `- Retain all existing sub-headings (e.g., 1.1, 1.2, 1.3, 1.4) and add new detailed subsections as appropriate.\n` +
          `- Expand every paragraph with deep theoretical context, empirical analysis, technical mechanisms, and APA citations.\n` +
          `- Return the complete expanded section in clean HTML (<h2/h3>, <p>, <ul>/<li>).`
      } else {
        enrichedPrompt =
          `The user wants to edit/expand a section but the exact section wasn't found in the document.\n\n` +
          `${docMeta}\n\n` +
          `${conversationCtx}` +
          `User request: "${trimmed}"\n\n` +
          `Current Document Full Structure Context:\n"""\n${metadata.editorHtml.replace(/<[^>]*>/g, ' ').slice(0, 3000)}\n"""\n\n` +
          `Generate a comprehensive, robust version of the section requested by the user. Write 1500-2500 words in clean HTML with clear sub-headings.`
      }
      break
    }

    case 'generate-section': {
      const sectionCtx = section
        ? extractSectionFromHtml(metadata.editorHtml, section)
        : ''

      enrichedPrompt =
        `Generate a comprehensive, robust section for this ${metadata.documentType} document.\n\n` +
        `${docMeta}\n\n` +
        `${conversationCtx}` +
        `User request: "${trimmed}"\n\n` +
        (sectionCtx
          ? `Existing content in the target area for reference:\n"""\n${sectionCtx.slice(0, 3000)}\n"""\n\n`
          : '') +
        `Write at least 500 words of rich, original academic content. Use HTML tags (<h2>, <h3>, <p>). ` +
        `Include analysis, citations (APA format), and critical evaluation.`
      break
    }

    case 'question':
      enrichedPrompt =
        `The user has a question about their document or needs guidance.\n\n` +
        `${docMeta}\n\n` +
        `${conversationCtx}` +
        `User question: "${trimmed}"\n\n` +
        `Provide a helpful, concise answer. If they're asking about document structure, reference their ` +
        `${metadata.documentType} document type. If they need writing help, offer specific suggestions ` +
        `and offer to generate content for them. Be conversational and helpful.`
      break

    case 'greeting':
      enrichedPrompt = '__GREETING__'
      break

    case 'format':
      enrichedPrompt = '__FORMAT__'
      break

    default:
      // Custom / general message - still enrich with context
      enrichedPrompt =
        `${docMeta}\n\n` +
        `${conversationCtx}` +
        `User message: "${trimmed}"\n\n` +
        `Respond helpfully. If the user is asking you to write or generate content, produce high-quality ` +
        `academic content in HTML. If they're asking a question, answer concisely. ` +
        `Always maintain awareness of the document context and previous conversation.`
      break
  }

  return {
    action: matchedIntent,
    targetSection: section,
    targetPage: page,
    originalMessage: trimmed,
    enrichedPrompt,
    requiresSelection,
    skipSelection
  }
}
