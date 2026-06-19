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
    const { prompt, context } = await req.json()

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

    const systemInstruction = 
      "You are an expert academic research writer assistant. Help the student write, refine, and format their research paper or thesis chapters.\n\n" +
      "Guidelines:\n" +
      "1. Maintain strict academic rigor, precise scientific terminology, and a professional, objective tone.\n" +
      "2. Do not use conversational filler (e.g., 'Sure, here is your text:', 'Hope this helps!'). Provide only the content requested.\n" +
      "3. Output structurally formatted text (using Markdown headings like H2/H3, paragraphs, blockquotes, and list items) that is clean and ready to render in the editor canvas.\n" +
      "4. REPLACEMENT DETECTION: If the user's request is to change, edit, correct, rewrite, or update a specific part of the provided document context (e.g., 'change the topic to...', 'correct grammar in...', 'rewrite section...'), you MUST identify the exact text inside the document that needs to be replaced, and output the response using the following format:\n" +
      "<<<ORIGINAL>>>\n" +
      "[Specify the exact text from the document context to be replaced. Match it word-for-word exactly, including spelling and punctuation.]\n" +
      "<<<REPLACEMENT>>>\n" +
      "[Specify the new, updated text or HTML. Use appropriate heading, list, or paragraph tags.]\n" +
      "<<<END>>>\n\n" +
      "If the user's request is a general generation task (like writing a new introduction, outline, or paragraph) that does not replace existing text, output the response directly without the <<<ORIGINAL>>> format."

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
