import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY

/**
 * Initializes and returns the Supabase client.
 * Returns null if the Supabase environment variables are not set,
 * allowing the application to fall back gracefully to local filesystem storage.
 */
export const getSupabaseClient = () => {
  if (!supabaseUrl || !supabaseAnonKey) {
    return null
  }
  try {
    return createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false // Disable session persistence for server-side operations
      }
    })
  } catch (error) {
    console.error('Failed to initialize Supabase client:', error)
    return null
  }
}
