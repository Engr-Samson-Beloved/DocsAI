import { GoogleGenerativeAI } from '@google/generative-ai'
import { NextRequest } from 'next/server'
import { requireAiAccess } from '../../../utils/entitlements/service'

/**
 * POST /api/plan
 * ------------------------------------------------------------------
 * The chat "action router" backend. Takes a planner prompt (built by
 * utils/chatPlanner) and returns the model's raw text, which the client
 * parses into a { tool, args, say } action. Non-streaming and JSON-only:
 * no humanization system prompt (that would corrupt the JSON).
 *
 * Kept intentionally lean — Gemini with model failover. On any error it
 * returns 500 and the client falls back to keyword classification, so
 * chat never hard-breaks.
 *
 * Gated but NOT metered: routing one chat turn is a Gemini call, so a free
 * account cannot make it, but the credit is charged by /api/generate when the
 * turn actually produces something. See requireAiAccess for the reasoning.
 *
 * Node rather than Edge, for the same reason as /api/generate: the entitlement
 * store falls back to the filesystem, which Edge has no access to.
 */

export const runtime = 'nodejs'

const PLANNER_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash']

export async function POST(req: NextRequest) {
  try {
    const { prompt } = await req.json()
    if (!prompt || typeof prompt !== 'string') {
      return new Response(JSON.stringify({ error: 'Prompt is required.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const access = await requireAiAccess(req)
    if (!access.ok) return access.response

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'GEMINI_API_KEY missing.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const genAI = new GoogleGenerativeAI(apiKey)

    let lastErr: unknown = null
    for (const modelName of PLANNER_MODELS) {
      try {
        const model = genAI.getGenerativeModel({
          model: modelName,
          systemInstruction:
            'You are a precise routing function. You ALWAYS respond with a single valid JSON object and nothing else — no prose, no markdown, no code fences.',
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 512,
            responseMimeType: 'application/json',
          },
        })
        const result = await model.generateContent(prompt)
        const text = result.response.text()
        if (text && text.trim()) {
          return new Response(JSON.stringify({ text, model: modelName }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
          })
        }
      } catch (e) {
        lastErr = e
        // try next model
      }
    }

    return new Response(
      JSON.stringify({ error: `Planner failed: ${lastErr instanceof Error ? lastErr.message : 'unknown'}` }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Bad request' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
