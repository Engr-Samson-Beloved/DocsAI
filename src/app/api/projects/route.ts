import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
/**
 * `resolveOwner` used to live here as a private helper. It moved to
 * utils/owner.ts unchanged when the Integrity Checker needed the same answer —
 * two copies of an ownership check is how one route ends up trusting a caller
 * the other rejects.
 */
import { resolveOwner } from '../../../utils/owner'

const DATA_DIR = path.join(process.cwd(), 'data')
const PROJECTS_DIR = path.join(DATA_DIR, 'projects')
const SOURCES_DIR = path.join(DATA_DIR, 'sources')

// Ensure storage directories exist. Returns false on read-only filesystems
// (serverless hosts) rather than throwing, so cloud writes still get a chance.
function ensureDirs(): boolean {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
    if (!fs.existsSync(PROJECTS_DIR)) fs.mkdirSync(PROJECTS_DIR, { recursive: true })
    if (!fs.existsSync(SOURCES_DIR)) fs.mkdirSync(SOURCES_DIR, { recursive: true })
    return true
  } catch (e) {
    console.warn('Local disk storage is unavailable (read-only filesystem?):', e)
    return false
  }
}

// Self-hosted single-user installs can opt back into the old shared behaviour
// for project files written before ownership was recorded.
const ALLOW_LEGACY_SHARED = process.env.ALLOW_LEGACY_SHARED_PROJECTS === 'true'

function readOwnedProjects(ownerKey: string): any[] {
  if (!ensureDirs()) return []
  let files: string[] = []
  try {
    files = fs.readdirSync(PROJECTS_DIR)
  } catch (e) {
    console.warn('Could not list local projects directory:', e)
    return []
  }

  return files
    .filter(f => f.endsWith('.json'))
    .map(file => {
      try {
        const raw = fs.readFileSync(path.join(PROJECTS_DIR, file), 'utf-8')
        return JSON.parse(raw)
      } catch (e) {
        console.error(`Failed to read project file: ${file}`, e)
        return null
      }
    })
    .filter(p => {
      if (!p) return false
      if (p._owner === undefined) return ALLOW_LEGACY_SHARED
      return p._owner === ownerKey
    })
    .map(project => {
      const clean = { ...project }
      delete clean._owner
      return clean
    })
}

// GET: Retrieve all projects belonging to the caller
export async function GET(req: NextRequest) {
  try {
    const { ownerKey, supabase, token, user, unauthorized } = await resolveOwner(req)

    if (unauthorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (supabase && token && user) {
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .or(`user_id.eq.${user.id},user_email.ilike.${user.email}`)
        .order('updated_at', { ascending: false })

      if (error) {
        console.error('Supabase get projects error:', error)
        if (error.code === 'PGRST301' || error.message.includes('JWT')) {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }
        throw error
      }

      // Map snake_case database columns to camelCase for client compatibility
      const projects = (data || []).map((p: any) => ({
        id: p.id,
        title: p.title,
        content: p.content,
        createdAt: Number(p.created_at),
        updatedAt: Number(p.updated_at),
        wordCount: p.word_count,
        charCount: p.char_count,
        documentType: p.document_type,
        academicLevel: p.academic_level,
        academicTone: p.academic_tone,
        docHeader: p.doc_header,
        docFooter: p.doc_footer
      }))

      return NextResponse.json(projects)
    }

    // Fallback: only this owner's projects from local disk
    return NextResponse.json(readOwnedProjects(ownerKey))
  } catch (error: any) {
    console.error('Failed to get projects:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// POST: Save/update a project
export async function POST(req: NextRequest) {
  try {
    const project = await req.json()
    if (!project || !project.id) {
      return NextResponse.json({ error: 'Invalid project data' }, { status: 400 })
    }

    const { ownerKey, supabase, token, user, unauthorized } = await resolveOwner(req)

    if (unauthorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let persisted = false

    // Cloud first: the local file is a cache, and on serverless hosts the disk
    // write fails. Doing it first meant the Supabase upsert was never reached.
    if (supabase && token && user) {
      const mappedProject = {
        id: project.id,
        title: project.title,
        content: project.content,
        created_at: project.createdAt,
        updated_at: project.updatedAt,
        word_count: project.wordCount,
        char_count: project.charCount,
        document_type: project.documentType,
        academic_level: project.academicLevel,
        academic_tone: project.academicTone,
        doc_header: project.docHeader,
        doc_footer: project.docFooter,
        user_id: user.id,
        user_email: user.email
      }

      const { error } = await supabase.from('projects').upsert(mappedProject)
      if (error) {
        console.error('Failed to sync project to Supabase:', error)
      } else {
        persisted = true
      }
    }

    // Best-effort local cache write, scoped to the owner
    if (ensureDirs()) {
      const filePath = path.join(PROJECTS_DIR, `${project.id}.json`)
      try {
        if (fs.existsSync(filePath)) {
          const existing = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
          if (existing._owner !== undefined && existing._owner !== ownerKey) {
            return NextResponse.json(
              { error: 'This project belongs to another account.' },
              { status: 403 }
            )
          }
        }
        fs.writeFileSync(filePath, JSON.stringify({ ...project, _owner: ownerKey }, null, 2), 'utf-8')
        persisted = true
      } catch (e) {
        console.warn('Local project cache write failed:', e)
      }
    }

    if (!persisted) {
      return NextResponse.json(
        { error: 'Could not persist the project to cloud storage or local disk.' },
        { status: 503 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Failed to save project:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// DELETE: Delete a project and its sources
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Project ID is required' }, { status: 400 })
    }

    const { ownerKey, supabase, token, user, unauthorized } = await resolveOwner(req)

    if (unauthorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (ensureDirs()) {
      const filePath = path.join(PROJECTS_DIR, `${id}.json`)
      try {
        if (fs.existsSync(filePath)) {
          const existing = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
          // Only the owner may delete. Legacy ownerless files stay deletable so
          // pre-existing installs can still clean up their own backups.
          if (existing._owner !== undefined && existing._owner !== ownerKey) {
            return NextResponse.json(
              { error: 'This project belongs to another account.' },
              { status: 403 }
            )
          }
          fs.unlinkSync(filePath)
        }

        // Delete associated sources owned by the same caller
        if (fs.existsSync(SOURCES_DIR)) {
          fs.readdirSync(SOURCES_DIR).forEach(file => {
            if (!file.endsWith('.json')) return
            try {
              const srcPath = path.join(SOURCES_DIR, file)
              const source = JSON.parse(fs.readFileSync(srcPath, 'utf-8'))
              const ownedByCaller = source._owner === undefined || source._owner === ownerKey
              if (source.projectId === id && ownedByCaller) {
                fs.unlinkSync(srcPath)
              }
            } catch (e) {
              console.error(`Failed to delete associated source file: ${file}`, e)
            }
          })
        }
      } catch (e) {
        console.warn('Local project delete failed:', e)
      }
    }

    // Delete from Supabase if configured and user is authenticated
    if (supabase && token && user) {
      // Due to CASCADE delete constraint in SQL schema, deleting the project
      // will automatically delete all associated sources in Supabase.
      const { error } = await supabase
        .from('projects')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id) // Ensure they own the project being deleted

      if (error) {
        console.error('Failed to delete project from Supabase:', error)
      }
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Failed to delete project:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
