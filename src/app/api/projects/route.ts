import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

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

// GET: Retrieve all projects from disk
export async function GET() {
  try {
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
    console.error('Failed to get projects from local storage:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// POST: Save/update a project
export async function POST(req: NextRequest) {
  try {
    ensureDirs()
    const project = await req.json()
    if (!project || !project.id) {
      return NextResponse.json({ error: 'Invalid project data' }, { status: 400 })
    }

    const filePath = path.join(PROJECTS_DIR, `${project.id}.json`)
    fs.writeFileSync(filePath, JSON.stringify(project, null, 2), 'utf-8')

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Failed to save project to local storage:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// DELETE: Delete a project and its sources
export async function DELETE(req: NextRequest) {
  try {
    ensureDirs()
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Project ID is required' }, { status: 400 })
    }

    const filePath = path.join(PROJECTS_DIR, `${id}.json`)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }

    // Delete associated sources from disk
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

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Failed to delete project from local storage:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
