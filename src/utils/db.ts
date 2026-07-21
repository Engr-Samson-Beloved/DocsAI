"use client"

import { Project } from '../components/Dashboard/Dashboard'

function getRequestHeaders(contentType = false): Record<string, string> {
  const headers: Record<string, string> = {}
  if (contentType) {
    headers['Content-Type'] = 'application/json'
  }
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('wordpi-session-token')
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }
  }
  return headers
}

export interface IngestedSource {
  id?: number
  projectId: string
  name: string
  content: string
  type: string
  addedAt: number
}

const DB_NAME = 'wordpi-db'
const DB_VERSION = 2
const STORE_SOURCES = 'project-sources'
const STORE_PROJECTS = 'projects'

export function initDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('IndexedDB is only available on client-side'))
      return
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => {
      reject(new Error('Failed to open IndexedDB database'))
    }

    request.onsuccess = () => {
      resolve(request.result)
    }

    request.onupgradeneeded = (event) => {
      const db = request.result
      const oldVersion = event.oldVersion

      // Version 1 setup (sources store)
      if (oldVersion < 1) {
        if (!db.objectStoreNames.contains(STORE_SOURCES)) {
          const store = db.createObjectStore(STORE_SOURCES, { keyPath: 'id', autoIncrement: true })
          store.createIndex('projectId', 'projectId', { unique: false })
        }
      }
      
      // Version 2 setup (projects store)
      if (oldVersion < 2) {
        if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
          db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' })
        }
      }
    }
  })
}

/* --- Project Store Helpers --- */

export async function saveProject(project: Project): Promise<void> {
  const db = await initDB()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_PROJECTS, 'readwrite')
    const store = transaction.objectStore(STORE_PROJECTS)
    const request = store.put(project)

    request.onsuccess = () => {
      // Sync to local filesystem server in background
      fetch('/api/projects', {
        method: 'POST',
        headers: getRequestHeaders(true),
        body: JSON.stringify(project)
      }).catch(e => console.warn('Background project sync failed:', e))
      
      resolve()
    }

    request.onerror = () => {
      reject(new Error('Failed to save project to IndexedDB'))
    }
  })
}

export async function getAllProjects(): Promise<Project[]> {
  try {
    const db = await initDB()
    const idbProjects = await new Promise<Project[]>((resolve, reject) => {
      const transaction = db.transaction(STORE_PROJECTS, 'readonly')
      const store = transaction.objectStore(STORE_PROJECTS)
      const request = store.getAll()

      request.onsuccess = () => {
        resolve(request.result || [])
      }

      request.onerror = () => {
        reject(new Error('Failed to retrieve projects from IndexedDB'))
      }
    })

    // If IndexedDB is empty, check server filesystem backup to restore it!
    if (idbProjects.length === 0) {
      console.log('IndexedDB is empty, checking local filesystem storage backup...')
      const res = await fetch('/api/projects', {
        headers: getRequestHeaders()
      })
      if (res.ok) {
        const serverProjects = await res.json() as Project[]
        if (serverProjects && serverProjects.length > 0) {
          console.log(`Found ${serverProjects.length} projects on disk backup. Restoring to IndexedDB...`)
          await saveProjectsBatch(serverProjects, false)
          return serverProjects
        }
      }
    }

    return idbProjects
  } catch (e) {
    console.error("getAllProjects error:", e)
    
    // Fallback to fetch from server directly if IndexedDB fails entirely
    try {
      const res = await fetch('/api/projects', {
        headers: getRequestHeaders()
      })
      if (res.ok) return await res.json()
    } catch (apiErr) {
      console.error("Server fallback fetch failed:", apiErr)
    }
    return []
  }
}

export async function syncProjects(): Promise<Project[]> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('wordpi-session-token') : null
  if (!token) return getAllProjects()

  try {
    const db = await initDB()
    const localProjects = await new Promise<Project[]>((resolve, reject) => {
      const transaction = db.transaction(STORE_PROJECTS, 'readonly')
      const store = transaction.objectStore(STORE_PROJECTS)
      const request = store.getAll()
      request.onsuccess = () => resolve(request.result || [])
      request.onerror = () => reject(new Error('Failed to retrieve projects from IndexedDB'))
    })

    const res = await fetch('/api/projects', {
      headers: getRequestHeaders()
    })
    if (!res.ok) {
      throw new Error(`Server returned ${res.status}`)
    }
    const serverProjects = await res.json() as Project[]

    const mergedProjectsMap = new Map<string, Project>()
    const projectsToUpload: Project[] = []
    const projectsToSaveLocal: Project[] = []

    // Seed map with server projects
    serverProjects.forEach(p => mergedProjectsMap.set(p.id, p))

    // Compare with local projects
    for (const localProj of localProjects) {
      const serverProj = mergedProjectsMap.get(localProj.id)
      if (serverProj) {
        if (localProj.updatedAt > serverProj.updatedAt) {
          // Local is newer
          mergedProjectsMap.set(localProj.id, localProj)
          projectsToUpload.push(localProj)
        } else if (serverProj.updatedAt > localProj.updatedAt) {
          // Server is newer
          projectsToSaveLocal.push(serverProj)
        }
      } else {
        // Only exists locally (e.g. created as guest)
        mergedProjectsMap.set(localProj.id, localProj)
        projectsToUpload.push(localProj)
      }
    }

    // Server projects that don't exist locally at all (e.g. from another device)
    serverProjects.forEach(serverProj => {
      const localProj = localProjects.find(p => p.id === serverProj.id)
      if (!localProj) {
        projectsToSaveLocal.push(serverProj)
      }
    })

    // Perform uploads
    if (projectsToUpload.length > 0) {
      console.log(`Syncing: Uploading ${projectsToUpload.length} projects to server...`)
      await Promise.all(
        projectsToUpload.map(async (project) => {
          try {
            await fetch('/api/projects', {
              method: 'POST',
              headers: getRequestHeaders(true),
              body: JSON.stringify(project)
            })
          } catch (e) {
            console.error(`Failed to upload project ${project.id} during sync:`, e)
          }
        })
      )
    }

    // Save server projects locally
    if (projectsToSaveLocal.length > 0) {
      console.log(`Syncing: Saving ${projectsToSaveLocal.length} projects locally...`)
      await saveProjectsBatch(projectsToSaveLocal, false) // false: do not post back to server
    }

    return Array.from(mergedProjectsMap.values())
  } catch (err) {
    console.error('Projects synchronization failed, falling back to local list:', err)
    return getAllProjects()
  }
}

export async function deleteProject(projectId: string): Promise<void> {
  const db = await initDB()
  
  // First delete project sources as well
  await deleteSourcesForProject(projectId)

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_PROJECTS, 'readwrite')
    const store = transaction.objectStore(STORE_PROJECTS)
    const request = store.delete(projectId)

    request.onsuccess = () => {
      // Sync delete to local filesystem server in background
      fetch(`/api/projects?id=${projectId}`, {
        method: 'DELETE',
        headers: getRequestHeaders()
      }).catch(e => console.warn('Background project delete sync failed:', e))

      resolve()
    }

    request.onerror = () => {
      reject(new Error('Failed to delete project from IndexedDB'))
    }
  })
}

export async function saveProjectsBatch(projects: Project[], syncToServer = true): Promise<void> {
  const db = await initDB()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_PROJECTS, 'readwrite')
    const store = transaction.objectStore(STORE_PROJECTS)
    
    transaction.oncomplete = () => {
      if (syncToServer) {
        // Sync batch in background
        projects.forEach(project => {
          fetch('/api/projects', {
            method: 'POST',
            headers: getRequestHeaders(true),
            body: JSON.stringify(project)
          }).catch(e => console.warn('Background project batch sync failed:', e))
        })
      }
      resolve()
    }
    
    transaction.onerror = () => {
      reject(new Error('Failed to save batch of projects to IndexedDB'))
    }
    
    projects.forEach(project => {
      store.put(project)
    })
  })
}

/* --- Project Sources Helpers --- */

export async function saveSource(projectId: string, name: string, content: string, type: string): Promise<IngestedSource> {
  const db = await initDB()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_SOURCES, 'readwrite')
    const store = transaction.objectStore(STORE_SOURCES)
    const source: IngestedSource = {
      projectId,
      name,
      content,
      type,
      addedAt: Date.now()
    }
    const request = store.add(source)

    request.onsuccess = () => {
      source.id = request.result as number
      
      // Sync source to local server filesystem in background
      fetch('/api/projects/sources', {
        method: 'POST',
        headers: getRequestHeaders(true),
        body: JSON.stringify(source)
      }).catch(e => console.warn('Background source save sync failed:', e))

      resolve(source)
    }

    request.onerror = () => {
      reject(new Error('Failed to save ingested source to IndexedDB'))
    }
  })
}

export async function getSourcesForProject(projectId: string): Promise<IngestedSource[]> {
  try {
    const db = await initDB()
    const idbSources = await new Promise<IngestedSource[]>((resolve, reject) => {
      const transaction = db.transaction(STORE_SOURCES, 'readonly')
      const store = transaction.objectStore(STORE_SOURCES)
      const index = store.index('projectId')
      const request = index.getAll(projectId)

      request.onsuccess = () => {
        resolve(request.result || [])
      }

      request.onerror = () => {
        reject(new Error('Failed to retrieve project sources from IndexedDB'))
      }
    })

    // If IndexedDB sources are empty, check server filesystem backup to restore it!
    if (idbSources.length === 0) {
      console.log(`IndexedDB sources empty for ${projectId}, checking local filesystem storage backup...`)
      const res = await fetch(`/api/projects/sources?projectId=${projectId}`, {
        headers: getRequestHeaders()
      })
      if (res.ok) {
        const serverSources = await res.json() as IngestedSource[]
        if (serverSources && serverSources.length > 0) {
          console.log(`Found ${serverSources.length} sources on disk backup. Restoring to IndexedDB...`)
          // Batch save them to IndexedDB
          const dbWrite = await initDB()
          const tx = dbWrite.transaction(STORE_SOURCES, 'readwrite')
          const sStore = tx.objectStore(STORE_SOURCES)
          serverSources.forEach(s => sStore.put(s))
          return serverSources
        }
      }
    }

    return idbSources
  } catch (e) {
    console.error("getSourcesForProject error:", e)
    // Fallback to fetch from server directly
    try {
      const res = await fetch(`/api/projects/sources?projectId=${projectId}`, {
        headers: getRequestHeaders()
      })
      if (res.ok) return await res.json()
    } catch (apiErr) {
      console.error("Server fallback fetch failed for sources:", apiErr)
    }
    return []
  }
}

export async function deleteSource(id: number): Promise<void> {
  const db = await initDB()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_SOURCES, 'readwrite')
    const store = transaction.objectStore(STORE_SOURCES)
    const request = store.delete(id)

    request.onsuccess = () => {
      // Sync delete to local filesystem server in background
      fetch(`/api/projects/sources?id=${id}`, {
        method: 'DELETE',
        headers: getRequestHeaders()
      }).catch(e => console.warn('Background source delete sync failed:', e))

      resolve()
    }

    request.onerror = () => {
      reject(new Error('Failed to delete ingested source from IndexedDB'))
    }
  })
}

export async function deleteSourcesForProject(projectId: string): Promise<void> {
  try {
    const db = await initDB()
    const sources = await getSourcesForProject(projectId)
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_SOURCES, 'readwrite')
      const store = transaction.objectStore(STORE_SOURCES)
      
      const deletePromises = sources.map(s => {
        return new Promise<void>((res, rej) => {
          if (s.id === undefined) return res()
          const req = store.delete(s.id)
          req.onsuccess = () => res()
          req.onerror = () => rej(new Error('Failed to delete source'))
        })
      })

      Promise.all(deletePromises)
        .then(() => resolve())
        .catch(err => reject(err))
    })
  } catch (e) {
    console.error("IndexedDB deleteSourcesForProject initialization error:", e)
  }
}

export async function clearAllLocalData(): Promise<void> {
  const db = await initDB()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_PROJECTS, STORE_SOURCES], 'readwrite')
    const projectsStore = transaction.objectStore(STORE_PROJECTS)
    const sourcesStore = transaction.objectStore(STORE_SOURCES)
    
    projectsStore.clear()
    sourcesStore.clear()
    
    transaction.oncomplete = () => {
      resolve()
    }
    
    transaction.onerror = () => {
      reject(new Error('Failed to clear local database stores'))
    }
  })
}
