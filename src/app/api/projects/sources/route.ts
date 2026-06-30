import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

const DATA_DIR = path.join(process.cwd(), 'data')
const SOURCES_DIR = path.join(DATA_DIR, 'sources')

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
    ensureDirs()
    const { searchParams } = new URL(req.url)
    const projectId = searchParams.get('projectId')

    if (!projectId) {
      return NextResponse.json({ error: 'Project ID is required' }, { status: 400 })
    }

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
    console.error('Failed to get sources from local storage:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// POST: Save a new source file
export async function POST(req: NextRequest) {
  try {
    ensureDirs()
    const source = await req.json() // Contains id, projectId, name, content, type, addedAt
    if (!source || !source.projectId || source.id === undefined) {
      return NextResponse.json({ error: 'Invalid source data' }, { status: 400 })
    }

    const filePath = path.join(SOURCES_DIR, `${source.id}.json`)
    fs.writeFileSync(filePath, JSON.stringify(source, null, 2), 'utf-8')

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Failed to save source to local storage:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// DELETE: Delete a specific source
export async function DELETE(req: NextRequest) {
  try {
    ensureDirs()
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Source ID is required' }, { status: 400 })
    }

    const filePath = path.join(SOURCES_DIR, `${id}.json`)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Failed to delete source from local storage:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
