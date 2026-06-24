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
    const { prompt, context, academicLevel, documentType } = await req.json()

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
      `- Support proper academic citation practices. Attach source references for every factual claim. Never present unsupported factual statements as verified facts.\n` +
      `- Write natural, human-like sentences. Avoid generic AI writing patterns.\n\n` +
      
      `ACADEMIC PERSONALITY LAYER:\n` +
      `- Adapt your tone, vocabulary complexity, and writing depth to the student's selected academic level: "${level}".\n` +
      `  * If Undergraduate: Structured, clear, academic, and introductory, matching a knowledgeable final-year undergraduate.\n` +
      `  * If Master's / Postgraduate: Authoritative, rigorous, comprehensive, and highly analytical, matching a postgraduate student.\n` +
      `  * If Ph.D. / Researcher: Highly technical, deeply analytical, original, and scholarly, matching a professional researcher.\n\n` +
      
      `HUMANIZATION & STYLE VARIATION RULES:\n` +
      `- Sentence Structure: Avoid repetitive sentence openings. Mix sentence lengths (use a blend of short, punchy statements and complex, multi-clause academic sentences).\n` +
      `- Paragraphs: Vary paragraph structures and lengths. Ensure context-aware transitions that build logical flow.\n` +
      `- Tone & Flow: Adopt a natural, professional academic flow. Introduce nuanced explanations and include practical examples where appropriate.\n` +
      `- AI Buzzwords to AVOID: Avoid robotic conclusions, excessive transition words (e.g., 'furthermore', 'moreover', 'consequently', 'firstly', 'lastly' used redundantly), and generic filler. Use discipline-specific language naturally.\n\n` +
      
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

    // Try prioritized models in sequence to handle server-side rate limits (503) or availability issues (404)
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

    if (!responseStream || !activeModelName) {
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
          // Enqueue active model name as initial meta event so the client knows which model served the request
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ meta: { model: activeModelName } })}\n\n`))

          for await (const chunk of responseStream.stream) {
            const chunkText = chunk.text()
            if (chunkText) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: chunkText })}\n\n`))
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
      JSON.stringify({ error: error.message || 'Failed to initialize Gemini stream handler' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
