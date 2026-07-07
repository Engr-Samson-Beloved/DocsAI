import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { getSupabaseClient } from '../../../utils/supabase'

const DATA_DIR = path.join(process.cwd(), 'data')
const PROJECTS_DIR = path.join(DATA_DIR, 'projects')
const SOURCES_DIR = path.join(DATA_DIR, 'sources')

// Ensure storage directories exist
function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }
  if (!fs.existsSync(PROJECTS_DIR)) {
    fs.mkdirSync(PROJECTS_DIR, { recursive: true })
  }
  if (!fs.existsSync(SOURCES_DIR)) {
    fs.mkdirSync(SOURCES_DIR, { recursive: true })
  }
}

// GET: Retrieve all projects
export async function GET() {
  try {
    const supabase = getSupabaseClient()
    if (supabase) {
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .order('updated_at', { ascending: false })

      if (error) throw error

      // Map snake_case database columns to camelCase for client compatibility
      const projects = (data || []).map(p => ({
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

    // Fallback: Retrieve all projects from local disk
    ensureDirs()
    const files = fs.readdirSync(PROJECTS_DIR)
    const projects = files
      .filter(f => f.endsWith('.json'))
      .map(file => {
        try {
          const filePath = path.join(PROJECTS_DIR, file)
          const raw = fs.readFileSync(filePath, 'utf-8')
          return JSON.parse(raw)
        } catch (e) {
          console.error(`Failed to read project file: ${file}`, e)
          return null
        }
      })
      .filter(p => p !== null)

    return NextResponse.json(projects)
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

    // Always save locally first (acts as local cache/fallback)
    ensureDirs()
    const filePath = path.join(PROJECTS_DIR, `${project.id}.json`)
    fs.writeFileSync(filePath, JSON.stringify(project, null, 2), 'utf-8')

    // Save to Supabase if configured
    const supabase = getSupabaseClient()
    if (supabase) {
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
        doc_footer: project.docFooter
      }

      const { error } = await supabase
        .from('projects')
        .upsert(mappedProject)

      if (error) {
        console.error('Failed to sync project to Supabase:', error)
        // We do not fail the request since local backup was successful
      }
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

    // Always delete locally first
    ensureDirs()
    const filePath = path.join(PROJECTS_DIR, `${id}.json`)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }

    // Delete associated sources locally
    if (fs.existsSync(SOURCES_DIR)) {
      const sourceFiles = fs.readdirSync(SOURCES_DIR)
      sourceFiles.forEach(file => {
        if (file.endsWith('.json')) {
          try {
            const srcPath = path.join(SOURCES_DIR, file)
            const raw = fs.readFileSync(srcPath, 'utf-8')
            const source = JSON.parse(raw)
            if (source.projectId === id) {
              fs.unlinkSync(srcPath)
            }
          } catch (e) {
            console.error(`Failed to delete associated source file: ${file}`, e)
          }
        }
      })
    }

    // Delete from Supabase if configured
    const supabase = getSupabaseClient()
    if (supabase) {
      // Due to CASCADE delete constraint in SQL schema, deleting the project
      // will automatically delete all associated sources in Supabase.
      const { error } = await supabase
        .from('projects')
        .delete()
        .eq('id', id)

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
