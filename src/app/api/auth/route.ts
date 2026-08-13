import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseClient } from '../../../utils/supabase'

/**
 * Mints an offline session. Only used when no Supabase project is configured at
 * all, i.e. local development or a self-hosted install with no cloud backend.
 * It is NOT a fallback for a configured backend that happens to be unreachable:
 * doing that would accept any password for a real account during an outage.
 */
function createLocalSession(email: string) {
  const mockToken = `local-token-${Date.now()}-${Buffer.from(email).toString('base64')}`
  return NextResponse.json({
    success: true,
    session: { access_token: mockToken },
    user: { email },
    localMode: true
  })
}

export async function POST(req: NextRequest) {
  try {
    const { action, email, password } = await req.json()
    const supabase = getSupabaseClient()

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required.' },
        { status: 400 }
      )
    }

    if (action !== 'signup' && action !== 'signin') {
      return NextResponse.json({ error: 'Invalid auth action.' }, { status: 400 })
    }

    if (!supabase) {
      // No cloud backend configured — offline mode, clearly flagged to the client
      return createLocalSession(email)
    }

    try {
      if (action === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        return NextResponse.json({
          success: true,
          session: data.session,
          user: data.user
        })
      }

      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
      return NextResponse.json({
        success: true,
        session: data.session,
        user: data.user
      })
    } catch (supabaseError: any) {
      console.error(`Supabase ${action} error:`, supabaseError)

      const errorMsg = supabaseError.message || String(supabaseError)
      const isNetworkError = errorMsg.includes('fetch failed') ||
                             errorMsg.includes('ENOTFOUND') ||
                             errorMsg.includes('ECONNREFUSED') ||
                             errorMsg.includes('network') ||
                             errorMsg.includes('TypeError')

      // Surface the outage instead of silently issuing an unauthenticated
      // session that would accept any password.
      if (isNetworkError) {
        return NextResponse.json(
          { error: 'We could not reach the account service. Please check your connection and try again in a moment.' },
          { status: 503 }
        )
      }

      return NextResponse.json(
        { error: errorMsg || 'Authentication failed.' },
        { status: 401 }
      )
    }
  } catch (error: any) {
    console.error('Authentication error:', error)
    return NextResponse.json(
      { error: error.message || 'Authentication failed.' },
      { status: 400 }
    )
  }
}
