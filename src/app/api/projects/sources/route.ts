import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { getSupabaseClient } from '../../../../utils/supabase'

const DATA_DIR = path.join(process.cwd(), 'data')
const SOURCES_DIR = path.join(DATA_DIR, 'sources')

// Helper to extract bearer token from headers
function getBearerToken(req: NextRequest): string | undefined {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return undefined
  const parts = authHeader.split(' ')
  if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
    return parts[1]
  }
  return undefined
}

/**
 * Identifies the caller so disk-backed sources stay partitioned per user.
 * Mirrors the owner resolution used for projects.
 */
async function resolveOwner(req: NextRequest): Promise<{
  ownerKey: string
  supabase: ReturnType<typeof getSupabaseClient>
  token?: string
  user: { id: string; email?: string } | null
  unauthorized: boolean
}> {
  const token = getBearerToken(req)
  const supabase = getSupabaseClient(token)

  if (token && token.startsWith('local-token-')) {
    const encoded = token.split('-').slice(3).join('-')
    try {
      const email = Buffer.from(encoded, 'base64').toString('utf-8').trim().toLowerCase()
      if (email) {
        return { ownerKey: `local:${email}`, supabase: null, token, user: null, unauthorized: false }
      }
    } catch {
      // fall through to guest
    }
    return { ownerKey: 'guest', supabase: null, token, user: null, unauthorized: false }
  }

  if (supabase && token) {
    const { data: { user }, error } = await supabase.auth.getUser()
    if (error || !user) {
      return { ownerKey: 'guest', supabase, token, user: null, unauthorized: true }
    }
    return {
      ownerKey: `user:${user.id}`,
      supabase,
      token,
      user: { id: user.id, email: user.email },
      unauthorized: false
    }
  }

  return { ownerKey: 'guest', supabase, token, user: null, unauthorized: false }
}

// Ensure storage directories exist without throwing on read-only filesystems
function ensureDirs(): boolean {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
    if (!fs.existsSync(SOURCES_DIR)) fs.mkdirSync(SOURCES_DIR, { recursive: true })
    return true
  } catch (e) {
    console.warn('Local disk storage is unavailable (read-only filesystem?):', e)
    return false
  }
}

const ALLOW_LEGACY_SHARED = process.env.ALLOW_LEGACY_SHARED_PROJECTS === 'true'

// GET: Retrieve sources for a specific project
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const projectId = searchParams.get('projectId')

    if (!projectId) {
      return NextResponse.json({ error: 'Project ID is required' }, { status: 400 })
    }

    const { ownerKey, supabase, token, user, unauthorized } = await resolveOwner(req)

    if (unauthorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (supabase && token && user) {
      const { data, error } = await supabase
        .from('project_sources')
        .select('*')
        .eq('project_id', projectId)

      if (error) {
        console.error('Supabase get sources error:', error)
        if (error.code === 'PGRST301' || error.message.includes('JWT')) {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }
        throw error
      }

      // Map database snake_case fields back to camelCase for client compatibility
      const sources = (data || []).map((s: any) => ({
        id: Number(s.id),
        projectId: s.project_id,
        name: s.name,
        content: s.content,
        type: s.type,
        addedAt: Number(s.added_at)
      }))

      return NextResponse.json(sources)
    }

    // Fallback: only this owner's sources from local disk
    if (!ensureDirs()) return NextResponse.json([])

    let files: string[] = []
    try {
      files = fs.readdirSync(SOURCES_DIR)
    } catch (e) {
      console.warn('Could not list local sources directory:', e)
      return NextResponse.json([])
    }

    const sources = files
      .filter(f => f.endsWith('.json'))
      .map(file => {
        try {
          const raw = fs.readFileSync(path.join(SOURCES_DIR, file), 'utf-8')
          return JSON.parse(raw)
        } catch (e) {
          console.error(`Failed to read source file: ${file}`, e)
          return null
        }
      })
      .filter(s => {
        if (!s || s.projectId !== projectId) return false
        if (s._owner === undefined) return ALLOW_LEGACY_SHARED
        return s._owner === ownerKey
      })
      .map(source => {
        const clean = { ...source }
        delete clean._owner
        return clean
      })

    return NextResponse.json(sources)
  } catch (error: any) {
    console.error('Failed to get sources:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// POST: Save a new source file
export async function POST(req: NextRequest) {
  try {
    const source = await req.json() // Contains id, projectId, name, content, type, addedAt
    if (!source || !source.projectId || source.id === undefined) {
      return NextResponse.json({ error: 'Invalid source data' }, { status: 400 })
    }

    const { ownerKey, supabase, token, user, unauthorized } = await resolveOwner(req)

    if (unauthorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let persisted = false

    // Cloud first so a read-only filesystem cannot block the durable write
    if (supabase && token && user) {
      const mappedSource = {
        id: source.id, // Primary key matches local IndexedDB auto-increment id
        project_id: source.projectId,
        user_email: user.email,
        name: source.name,
        content: source.content,
        type: source.type,
        added_at: source.addedAt
      }

      const { error } = await supabase.from('project_sources').upsert(mappedSource)
      if (error) {
        console.error('Failed to sync source to Supabase:', error)
      } else {
        persisted = true
      }
    }

    if (ensureDirs()) {
      const filePath = path.join(SOURCES_DIR, `${source.id}.json`)
      try {
        if (fs.existsSync(filePath)) {
          const existing = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
          if (existing._owner !== undefined && existing._owner !== ownerKey) {
            return NextResponse.json(
              { error: 'This source belongs to another account.' },
              { status: 403 }
            )
          }
        }
        fs.writeFileSync(filePath, JSON.stringify({ ...source, _owner: ownerKey }, null, 2), 'utf-8')
        persisted = true
      } catch (e) {
        console.warn('Local source cache write failed:', e)
      }
    }

    if (!persisted) {
      return NextResponse.json(
        { error: 'Could not persist the source to cloud storage or local disk.' },
        { status: 503 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Failed to save source:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// DELETE: Delete a specific source
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Source ID is required' }, { status: 400 })
    }

    const { ownerKey, supabase, token, user, unauthorized } = await resolveOwner(req)

    if (unauthorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (ensureDirs()) {
      const filePath = path.join(SOURCES_DIR, `${id}.json`)
      try {
        if (fs.existsSync(filePath)) {
          const existing = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
          if (existing._owner !== undefined && existing._owner !== ownerKey) {
            return NextResponse.json(
              { error: 'This source belongs to another account.' },
              { status: 403 }
            )
          }
          fs.unlinkSync(filePath)
        }
      } catch (e) {
        console.warn('Local source delete failed:', e)
      }
    }

    if (supabase && token && user) {
      const { error } = await supabase
        .from('project_sources')
        .delete()
        .eq('id', parseInt(id))

      if (error) {
        console.error('Failed to delete source from Supabase:', error)
      }
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Failed to delete source:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
