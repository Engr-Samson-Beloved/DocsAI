import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY

/**
 * Initializes and returns the Supabase client.
 * Returns null if the Supabase environment variables are not set,
 * allowing the application to fall back gracefully to local filesystem storage.
 */
export const getSupabaseClient = (userToken?: string) => {
  if (!supabaseUrl || !supabaseAnonKey) {
    return null
  }
  // Sanitize the URL to remove any trailing slashes or /rest/v1 suffixes
  let cleanUrl = supabaseUrl.trim()
  if (cleanUrl.endsWith('/')) {
    cleanUrl = cleanUrl.slice(0, -1)
  }
  if (cleanUrl.endsWith('/rest/v1')) {
    cleanUrl = cleanUrl.slice(0, -8)
  }
  if (cleanUrl.endsWith('/')) {
    cleanUrl = cleanUrl.slice(0, -1)
  }

  const headers: Record<string, string> = {}
  if (userToken) {
    headers['Authorization'] = `Bearer ${userToken}`
  }

  try {
    return createClient(cleanUrl, supabaseAnonKey, {
      auth: {
        persistSession: false // Disable session persistence for server-side operations
      },
      global: {
        headers
      }
    })
  } catch (error) {
    console.error('Failed to initialize Supabase client:', error)
    return null
  }
}
