import { GoogleGenerativeAI } from '@google/generative-ai'
import { NextRequest } from 'next/server'

export const runtime = 'edge' // Enable Edge Runtime for lightweight and high performance streaming

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
      // In development or if the key is missing, return a descriptive error response
      return new Response(
        JSON.stringify({ 
          error: 'GEMINI_API_KEY environment variable is missing. Please create a .env.local file in the project root and add GEMINI_API_KEY=your_key_here.' 
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const genAI = new GoogleGenerativeAI(apiKey)
    
    // Set up the model with system instruction for educational writing
    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      systemInstruction: 
        "You are an expert academic research writer assistant. Help the student write, refine, and format their research paper or thesis chapters.\n\n" +
        "Guidelines:\n" +
        "1. Maintain strict academic rigor, precise scientific terminology, and a professional, objective tone.\n" +
        "2. Do not use conversational filler (e.g., 'Sure, here is your text:', 'Hope this helps!'). Provide only the content requested.\n" +
        "3. Output structurally formatted text (using Markdown headings like H2/H3, paragraphs, blockquotes, and list items) that is clean and ready to render in the editor canvas."
    })

    // Construct full prompt using surrounding document context if available
    let contentPrompt = prompt
    if (context) {
      contentPrompt = `Surrounding Document Context:\n\"\"\"\n${context}\n\"\"\"\n\nRequested Task: ${prompt}\n\nPlease generate the relevant section, ensuring it flows naturally with the surrounding context provided above. Avoid repeat greetings or intro text.`
    }

    const responseStream = await model.generateContentStream({
      contents: [{ role: 'user', parts: [{ text: contentPrompt }] }],
    })

    const encoder = new TextEncoder()
    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of responseStream.stream) {
            const chunkText = chunk.text()
            if (chunkText) {
              // Format chunk as standard Server-Sent Event (SSE)
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: chunkText })}\n\n`))
            }
          }
        } catch (error: any) {
          console.error('Gemini stream error:', error)
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: error.message || 'Stream error encountered.' })}\n\n`))
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
    console.error('Edge generate handler error:', error)
    return new Response(
      JSON.stringify({ error: error.message || 'Failed to initialize Gemini stream handler' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
