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

// Ensure storage directories exist
function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }
  if (!fs.existsSync(SOURCES_DIR)) {
    fs.mkdirSync(SOURCES_DIR, { recursive: true })
  }
}

// GET: Retrieve sources for a specific project
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const projectId = searchParams.get('projectId')

    if (!projectId) {
      return NextResponse.json({ error: 'Project ID is required' }, { status: 400 })
    }

    const token = getBearerToken(req)
    const supabase = getSupabaseClient(token)
    if (supabase && token) {
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
      const sources = (data || []).map(s => ({
        id: Number(s.id),
        projectId: s.project_id,
        name: s.name,
        content: s.content,
        type: s.type,
        addedAt: Number(s.added_at)
      }))

      return NextResponse.json(sources)
    }

    // Fallback: Retrieve sources from local disk
    ensureDirs()
    const files = fs.readdirSync(SOURCES_DIR)
    const sources = files
      .filter(f => f.endsWith('.json'))
      .map(file => {
        try {
          const filePath = path.join(SOURCES_DIR, file)
          const raw = fs.readFileSync(filePath, 'utf-8')
          return JSON.parse(raw)
        } catch (e) {
          console.error(`Failed to read source file: ${file}`, e)
          return null
        }
      })
      .filter(s => s !== null && s.projectId === projectId)

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

    // Always save locally first (acts as local cache/fallback)
    ensureDirs()
    const filePath = path.join(SOURCES_DIR, `${source.id}.json`)
    fs.writeFileSync(filePath, JSON.stringify(source, null, 2), 'utf-8')

    // Sync to Supabase if active and token is provided
    const token = getBearerToken(req)
    const supabase = getSupabaseClient(token)
    if (supabase && token) {
      // Validate user token
      const { data: { user }, error: userError } = await supabase.auth.getUser()
      if (userError || !user) {
        console.error('Failed to authenticate token:', userError)
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const mappedSource = {
        id: source.id, // Primary key matches local IndexedDB auto-increment id
        project_id: source.projectId,
        name: source.name,
        content: source.content,
        type: source.type,
        added_at: source.addedAt
      }

      const { error } = await supabase
        .from('project_sources')
        .upsert(mappedSource)

      if (error) {
        console.error('Failed to sync source to Supabase:', error)
        // Do not fail since local storage succeeded
      }
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

    // Always delete locally first
    ensureDirs()
    const filePath = path.join(SOURCES_DIR, `${id}.json`)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }

    // Delete from Supabase if active and token is provided
    const token = getBearerToken(req)
    const supabase = getSupabaseClient(token)
    if (supabase && token) {
      // Validate user token
      const { data: { user }, error: userError } = await supabase.auth.getUser()
      if (userError || !user) {
        console.error('Failed to authenticate token:', userError)
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

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
