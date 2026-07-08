import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseClient } from '../../../utils/supabase'

export async function POST(req: NextRequest) {
  try {
    const { action, email, password } = await req.json()
    const supabase = getSupabaseClient()

    if (!supabase) {
      return NextResponse.json(
        { error: 'Supabase is not configured on the server.' },
        { status: 501 }
      )
    }

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required.' },
        { status: 400 }
      )
    }

    if (action === 'signup') {
      const { data, error } = await supabase.auth.signUp({ email, password })
      if (error) throw error
      return NextResponse.json({
        success: true,
        session: data.session,
        user: data.user
      })
    } else if (action === 'signin') {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
      return NextResponse.json({
        success: true,
        session: data.session,
        user: data.user
      })
    } else {
      return NextResponse.json(
        { error: 'Invalid auth action.' },
        { status: 400 }
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
