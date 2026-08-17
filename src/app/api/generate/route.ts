import { GoogleGenerativeAI } from '@google/generative-ai'
import { NextRequest } from 'next/server'
import { requireFeature } from '../../../utils/entitlements/service'
import type { MeteredFeature } from '../../../utils/plans'

/**
 * Node rather than Edge.
 *
 * This route used to run on the Edge runtime for streaming. It now has to make
 * a paywall decision first, and the entitlement store falls back to the
 * filesystem when Supabase is not configured — `fs` does not exist on Edge, and
 * an install with no cloud backend would have had no way to count usage at all.
 * Streaming still works here: the handler returns the same ReadableStream, and
 * Node's runtime streams it the same way.
 */
export const runtime = 'nodejs'
export const maxDuration = 60

// Prioritized list of Gemini models to support automatic failover on 503 / 404
const PRIORITIZED_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash'
]

/**
 * Which bucket this generation is charged to.
 *
 * A full report is one of only two a Base subscriber gets per cycle, so it must
 * not be spent on a request to rephrase one paragraph. The client says which it
 * is asking for, and anything unrecognised is charged as an `assist` — the
 * cheap bucket — so a caller cannot dodge metering by omitting the field, and
 * cannot be over-charged by sending a bad one.
 */
function featureFor(value: unknown): MeteredFeature {
  return value === 'report' ? 'report' : 'assist'
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { prompt, context, academicLevel, documentType, modelTarget, projectId } = body

    if (!prompt) {
      return new Response(
        JSON.stringify({ error: 'Prompt is required.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // The paywall, before a single token is bought. Free accounts have a quota
    // of 0 on both buckets and are refused here (§ utils/plans.ts).
    const grant = await requireFeature(req, featureFor(body.feature))
    if (!grant.ok) return grant.response

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      await grant.fail('config', 'GEMINI_API_KEY is not configured', 500)
      return new Response(
        JSON.stringify({
          error: 'GEMINI_API_KEY environment variable is missing. Please create a .env.local file in the project root and add GEMINI_API_KEY=your_key_here.'
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const genAI = new GoogleGenerativeAI(apiKey)
    
    // Construct full prompt using surrounding document context if available
    let contentPrompt = prompt
    if (context) {
      contentPrompt = `Surrounding Document Context:\n\"\"\"\n${context}\n\"\"\"\n\nRequested Task: ${prompt}\n\nPlease generate the relevant section, ensuring it flows naturally with the surrounding context provided above. Avoid repeat greetings or intro text.`
    }

    const level = academicLevel || 'Undergraduate'
    const docType = documentType || 'Custom'

    const systemInstruction = 
      `You are WordPI, an advanced, context-aware academic research writing assistant.\n\n` +
      `CORE PHILOSOPHY & ACADEMIC INTEGRITY:\n` +
      `- You must NOT function as a content-spinning or simple paraphrasing/plagiarism-avoidance tool. Do not rely on simple sentence rewriting.\n` +
      `- Generate original, high-quality academic content synthesized from verified knowledge.\n` +
      `- Encourage critical thinking and synthesis by comparing findings across multiple sources, highlighting agreements, contradictions, trends, and research gaps.\n` +
      `- Support proper academic citation practices. Attach source references for every factual claim. Never present unsupported factual statements as verified facts.\n\n` +
      
      `ANTI-PLAGIARISM & ORIGINALITY (CRITICAL — 0% PLAGIARISM TARGET):\n` +
      `- Completely rephrase every single sentence in your own original words. Never preserve source phrasing longer than 4 consecutive words.\n` +
      `- Synthesize facts and technical data using entirely original sentence structures and paragraph organization.\n` +
      `- Never quote or echo text verbatim from references or style prompts.\n\n` +

      `HUMANIZATION & ANTI-AI-DETECTION RULES (CRITICAL — TARGET UNDER 5% AI):\n` +
      `- SENTENCE-LEVEL DISORDER (HIGH PERPLEXITY):\n` +
      `  * Never allow two consecutive sentences to use identical grammatical openers. Vary between subject-verb, dependent clauses, prepositional phrases, and rhetorical questions.\n` +
      `  * Mix sentence lengths aggressively: follow a long 35-word analytical sentence with a short 5-word observation.\n` +
      `  * Scatter occasional rhetorical questions naturally ("But why does this matter in practice?", "How does this scale?").\n` +
      `  * Use parenthetical asides with em-dashes or parentheses to break rigid prose.\n` +
      `  * Connect ideas using cause-and-effect reasoning inside the sentence ("which is why", "because", "meaning that") rather than formal transition adverbs.\n\n` +

      `- PARAGRAPH DISORDER (HIGH BURSTINESS):\n` +
      `  * Avoid uniform paragraph lengths. Mix 150-word deep-dives with brief 30-word transitional observations.\n` +
      `  * Do not format every paragraph as 'Topic Sentence -> Support -> Conclusion'. Vary paragraph structure organically.\n\n` +
      
      `- ELIMINATE AI BUZZWORDS & ROBOTIC TRANSITIONS:\n` +
      `  * NEVER use: "furthermore", "moreover", "consequently", "subsequently", "thereby", "therein", "holistic", "holistically", "firstly/secondly/finally" (in lists), "it is crucial to note", "it is important to remember", "testament to", "beacon of", "tapestry", "delve", "demystify", "holistic approach", "in conclusion" (at the end of sections).\n` +
      `  * Instead of transition adverbs, build flow logically by connecting the subject of a new sentence to the conclusion of the previous one (e.g., instead of "Furthermore, this method has...", use "This method's primary advantage is...").\n` +
      `  * Use conversational yet academic connectors when absolutely necessary: "Yet", "Still", "Indeed", "Instead", "Ultimately", "Historically", "In practice", "In this context".\n\n` +
      
      `- AVOID PLACEHOLDERS & RIGID PATTERNS:\n` +
      `  * NEVER output markdown placeholders like "[Source A, Year]" or "[Author, Year]" in the text. If referencing, synthesize a natural academic citation (e.g., "Adeyinka (2025)", "(Bello, 2026)") or write the statement factually without mock placeholder tags.\n` +
      `  * Human writing is organic, not a perfectly balanced machine. Do not structure every paragraph as: 'Introduction Sentence -> Three points -> Conclusion Sentence'.\n` +
      `  * Avoid perfect lists of three (e.g., 'efficiency, stability, and speed'). Focus on analyzing one main variable, contrast it with a secondary one, and explain the nuance.\n` +
      `  * Do NOT summarize the entire section at the end of every section. A human writer stops when the argument is complete and transitions directly to the next point.\n` +
      `  * Introduce slight stylistic variation and vocabulary that is context-appropriate rather than generic, high-flown academic vocabulary. Use precise, discipline-specific terms naturally.\n\n` +
      
      `ACADEMIC PERSONALITY LAYER:\n` +
      `- Adapt your tone, vocabulary complexity, and writing depth to the student's selected academic level: "${level}".\n` +
      `  * If Undergraduate: Structured, clear, academic, and introductory, matching a knowledgeable final-year undergraduate.\n` +
      `  * If Master's / Postgraduate: Authoritative, rigorous, comprehensive, and highly analytical, matching a postgraduate student.\n` +
      `  * If Ph.D. / Researcher: Highly technical, deeply analytical, original, and scholarly, matching a professional researcher.\n\n` +
      
      `CRITICAL THINKING & RESEARCH SYNTHESIS LAYER:\n` +
      `- Every section should include detailed analysis, interpretation, evaluation, and comparison rather than generic definitions.\n` +
      `- Answer: Why? How? What are the implications? What are the limitations?\n` +
      `- Incorporate localized academic contexts, industry-specific examples, real-world applications, and relevant case studies (including Nigerian/local context where applicable to the topic).\n` +
      `- Citation Intelligence: Ensure all factual claims, references, and citations are formatted strictly according to APA style (7th edition) throughout the document.\n\n` +
      
      `REPLACEMENT DETECTION:\n` +
      `If the user's request is to change, edit, correct, rewrite, or update a specific part of the document context, you MUST output the response using this format:\n` +
      `<<<ORIGINAL>>>\n` +
      `[Specify the exact text from the document context to be replaced word-for-word]\n` +
      `<<<REPLACEMENT>>>\n` +
      `[Specify the new, updated text/HTML]\n` +
      `<<<END>>>\n\n` +
      `For general writing or blueprint generation that does not replace existing text, output the response directly without the <<<ORIGINAL>>> format.`

    let responseStream: any = null
    let openAiStreamResponse: Response | null = null
    let activeModelName = ''
    let lastError: any = null

    // Helper to request OpenAI-compatible stream targets (Grok or Groq)
    async function tryOpenAiApi(provider: 'grok' | 'groq'): Promise<{ name: string; response: Response }> {
      const apiKey = provider === 'groq' ? process.env.GROQ_API_KEY : process.env.GROK_API_KEY
      if (!apiKey) {
        throw new Error(`${provider.toUpperCase()}_API_KEY is not configured on the server.`)
      }

      const url = provider === 'groq' 
        ? 'https://api.groq.com/openai/v1/chat/completions' 
        : 'https://api.x.ai/v1/chat/completions'

      const model = provider === 'groq' ? 'llama-3.3-70b-versatile' : 'grok-2-1212'

      console.log(`Initiating stream request to ${provider} using model: ${model}`)
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          stream: true,
          messages: [
            { role: 'system', content: systemInstruction },
            { role: 'user', content: contentPrompt }
          ]
        })
      })

      if (!response.ok) {
        const errText = await response.text()
        throw new Error(`${provider.toUpperCase()} API returned error status ${response.status}: ${errText}`)
      }

      return { name: model, response }
    }

    // Determine cascade priority list
    const targetOrder: Array<'gemini' | 'groq' | 'grok'> = []
    if (modelTarget === 'groq') {
      targetOrder.push('groq', 'gemini', 'grok')
    } else if (modelTarget === 'grok') {
      targetOrder.push('grok', 'groq', 'gemini')
    } else {
      targetOrder.push('gemini', 'groq', 'grok')
    }

    // Execute priority execution chain
    for (const provider of targetOrder) {
      try {
        if (provider === 'gemini') {
          // Try prioritized Gemini models
          for (const modelName of PRIORITIZED_MODELS) {
            try {
              console.log(`Starting generation attempt with model: ${modelName}`)
              const model = genAI.getGenerativeModel({
                model: modelName,
                systemInstruction: systemInstruction,
                tools: [{ googleSearchRetrieval: {} }]
              })

              responseStream = await model.generateContentStream({
                contents: [{ role: 'user', parts: [{ text: contentPrompt }] }],
              })

              activeModelName = modelName
              console.log(`Successfully established stream using model: ${modelName}`)
              break
            } catch (err: any) {
              console.warn(`Model ${modelName} failed or unavailable. Error:`, err.message || err)
              lastError = err
            }
          }
          if (activeModelName) break
        } else {
          // Try Groq or Grok
          const result = await tryOpenAiApi(provider)
          activeModelName = result.name
          openAiStreamResponse = result.response
          console.log(`Successfully established stream using provider: ${provider}`)
          break
        }
      } catch (err: any) {
        console.warn(`Provider ${provider} failed or was skipped. Error:`, err.message || err)
        lastError = err
      }
    }

    if (!activeModelName) {
      // Nothing was generated, so nothing is charged.
      await grant.fail(
        'upstream',
        `All providers failed: ${lastError?.message || lastError || 'unknown'}`,
        503
      )
      return new Response(
        JSON.stringify({
          error: `All configured models returned errors. Last error details: ${lastError?.message || lastError || 'Unknown Error'}. Please retry shortly or verify your key access.`
        }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const encoder = new TextEncoder()

    // Charged only once the model has actually produced text. A stream that
    // dies before its first token cost the user nothing and must not cost them
    // one of two monthly reports either.
    let deliveredText = false

    const readableStream = new ReadableStream({
      async start(controller) {
        /** Every text delta goes through here, so the charge flag cannot be missed. */
        const sendText = (text: string) => {
          deliveredText = true
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`))
        }

        try {
          // Enqueue active model name as initial meta event
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ meta: { model: activeModelName } })}\n\n`))

          if (openAiStreamResponse) {
            const reader = openAiStreamResponse.body?.getReader()
            if (!reader) {
              throw new Error('Response body reader is not available')
            }

            const decoder = new TextDecoder()
            let buffer = ''

            try {
              while (true) {
                const { done, value } = await reader.read()
                if (done) break

                buffer += decoder.decode(value, { stream: true })
                const lines = buffer.split('\n')
                buffer = lines.pop() || ''

                for (const line of lines) {
                  const cleanLine = line.trim()
                  if (cleanLine === 'data: [DONE]') continue
                  if (cleanLine.startsWith('data: ')) {
                    try {
                      const parsed = JSON.parse(cleanLine.substring(6))
                      const text = parsed.choices?.[0]?.delta?.content
                      if (text) sendText(text)
                    } catch (e) {
                      // Skip parsing errors on incomplete JSON segments
                    }
                  }
                }
              }
              // Flush any remaining buffer
              const finalLine = buffer.trim()
              if (finalLine.startsWith('data: ') && finalLine !== 'data: [DONE]') {
                try {
                  const parsed = JSON.parse(finalLine.substring(6))
                  const text = parsed.choices?.[0]?.delta?.content
                  if (text) sendText(text)
                } catch (e) {}
              }
            } finally {
              reader.releaseLock()
            }
          } else if (responseStream) {
            // Stream from Gemini API
            for await (const chunk of responseStream.stream) {
              const chunkText = chunk.text()
              if (chunkText) sendText(chunkText)
            }
          }
        } catch (error: any) {
          console.error('Streaming chunk delivery failure:', error)
          await grant.fail('upstream', error?.message || 'Stream delivery failed', 502)
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: error.message || 'Stream error encountered during delivery.' })}\n\n`))
        } finally {
          // The charge lands here rather than before the stream opened, so a
          // generation that produced nothing is free. A partial stream is
          // charged in full: the tokens were bought either way, and the user
          // keeps whatever prose arrived.
          if (deliveredText) {
            await grant.commit({ projectId: projectId ?? null, metadata: { model: activeModelName } })
          }
          controller.enqueue(encoder.encode(`data: [DONE]\n\n`))
          controller.close()
        }
      }
    })

    return new Response(readableStream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  } catch (error: any) {
    console.error('Generate handler root error:', error)
    return new Response(
      JSON.stringify({ error: error.message || 'Failed to initialize generation stream' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
