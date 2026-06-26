import { GoogleGenerativeAI } from '@google/generative-ai'
import { NextRequest } from 'next/server'

export const runtime = 'edge' // Enable Edge Runtime for lightweight and high performance streaming

// Prioritized list of Gemini models to support automatic failover on 503 / 404
const PRIORITIZED_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash'
]

export async function POST(req: NextRequest) {
  try {
    const { prompt, context, academicLevel, documentType, modelTarget } = await req.json()

    if (!prompt) {
      return new Response(
        JSON.stringify({ error: 'Prompt is required.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
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
      
      `HUMANIZATION & ANTI-AI-DETECTION RULES (CRITICAL):\n` +
      `- HIGH PERPLEXITY & BURSTINESS: Modern AI detectors look for low perplexity (predictable word choices) and uniform burstiness (similar sentence lengths). You MUST break this pattern:\n` +
      `  * Mix sentence lengths aggressively: Follow a long, multi-clause analytical sentence (30-40 words) with a short, punchy, direct statement (5-8 words).\n` +
      `  * Avoid symmetrical paragraph lengths. Let one paragraph focus deeply on a core concept (200 words), followed by a brief, transitional paragraph (50 words).\n` +
      `  * Vary sentence structure: Do not start consecutive sentences with the same grammatical structure (e.g., Avoid starting sentences with adverbial phrases or gerunds like 'By analyzing...', 'Furthermore...', 'Interestingly...').\n` +
      `  * Use active voice where natural to drive the argument, and reserve passive voice for objective data representation.\n\n` +
      
      `- ELIMINATE AI BUZZWORDS & ROBOTIC TRANSITIONS:\n` +
      `  * NEVER use: "furthermore", "moreover", "consequently", "subsequently", "thereby", "firstly/secondly/finally" (in lists), "it is crucial to note", "it is important to remember", "testament to", "beacon of", "tapestry", "delve", "demystify", "holistic approach", "in conclusion" (at the end of sections).\n` +
      `  * Instead of transition adverbs, build flow logically by connecting the subject of a new sentence to the conclusion of the previous one (e.g., instead of "Furthermore, this method has...", use "This method's primary advantage is...").\n` +
      `  * Use conversational yet academic connectors when absolutely necessary: "Yet", "Still", "Indeed", "Instead", "Ultimately", "Historically", "In practice", "In this context".\n\n` +
      
      `- AVOID RIGID & PERFECT PATTERNS:\n` +
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
      `- Citation Intelligence: Ensure all factual claims support citation formatting (e.g., APA, IEEE, Harvard, or MLA) based on the document type: "${docType}".\n\n` +
      
      `REPLACEMENT DETECTION:\n` +
      `If the user's request is to change, edit, correct, rewrite, or update a specific part of the document context, you MUST output the response using this format:\n` +
      `<<<ORIGINAL>>>\n` +
      `[Specify the exact text from the document context to be replaced word-for-word]\n` +
      `<<<REPLACEMENT>>>\n` +
      `[Specify the new, updated text/HTML]\n` +
      `<<<END>>>\n\n` +
      `For general writing or blueprint generation that does not replace existing text, output the response directly without the <<<ORIGINAL>>> format.`

    let responseStream: any = null
    let activeModelName = ''
    let lastError: any = null

    // Determine target engine
    const isGrokTarget = modelTarget === 'grok'

    if (isGrokTarget && process.env.GROK_API_KEY) {
      activeModelName = 'grok-2'
      console.log('Routing request directly to xAI Grok API')
    } else {
      // Try prioritized Gemini models
      for (const modelName of PRIORITIZED_MODELS) {
        try {
          console.log(`Starting generation attempt with model: ${modelName}`)
          const model = genAI.getGenerativeModel({
            model: modelName,
            systemInstruction: systemInstruction
          })

          // Call stream generator
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

      // Automatically fall back to Grok if Gemini is rate-limited or fails
      if ((!responseStream || !activeModelName) && process.env.GROK_API_KEY) {
        console.warn('All Gemini models failed. Initiating cooperative failover to xAI Grok API')
        activeModelName = 'grok-2'
      }
    }

    if (!activeModelName) {
      return new Response(
        JSON.stringify({ 
          error: `All configured Gemini models returned errors. Last error details: ${lastError?.message || lastError || 'Unknown Error'}. Please retry shortly or verify your key access.` 
        }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const encoder = new TextEncoder()
    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          if (activeModelName.startsWith('grok')) {
            const grokApiKey = process.env.GROK_API_KEY
            if (!grokApiKey) {
              throw new Error('GROK_API_KEY is not configured on the server.')
            }

            // Enqueue active model name as initial meta event
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ meta: { model: activeModelName } })}\n\n`))

            // Fetch from xAI API (compatible with OpenAI format)
            const response = await fetch('https://api.x.ai/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${grokApiKey}`
              },
              body: JSON.stringify({
                model: 'grok-2',
                stream: true,
                messages: [
                  { role: 'system', content: systemInstruction },
                  { role: 'user', content: contentPrompt }
                ]
              })
            })

            if (!response.ok) {
              const errText = await response.text()
              throw new Error(`Grok API returned error: ${errText}`)
            }

            const reader = response.body?.getReader()
            if (!reader) {
              throw new Error('Grok response body reader is not available')
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
                      if (text) {
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`))
                      }
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
                  if (text) {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`))
                  }
                } catch (e) {}
              }
            } finally {
              reader.releaseLock()
            }
          } else {
            // Stream from Gemini API
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ meta: { model: activeModelName } })}\n\n`))

            for await (const chunk of responseStream.stream) {
              const chunkText = chunk.text()
              if (chunkText) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: chunkText })}\n\n`))
              }
            }
          }
        } catch (error: any) {
          console.error('Streaming chunk delivery failure:', error)
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: error.message || 'Stream error encountered during delivery.' })}\n\n`))
        } finally {
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
    console.error('Edge generate handler root error:', error)
    return new Response(
      JSON.stringify({ error: error.message || 'Failed to initialize generation stream' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
