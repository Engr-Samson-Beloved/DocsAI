"use client"

export interface IngestedSource {
  id?: number
  projectId: string
  name: string
  content: string
  type: string
  addedAt: number
}

const DB_NAME = 'project-pilot-db'
const DB_VERSION = 1
const STORE_NAME = 'project-sources'

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

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true })
        store.createIndex('projectId', 'projectId', { unique: false })
      }
    }
  })
}

export async function saveSource(projectId: string, name: string, content: string, type: string): Promise<IngestedSource> {
  const db = await initDB()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
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
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly')
      const store = transaction.objectStore(STORE_NAME)
      const index = store.index('projectId')
      const request = index.getAll(projectId)

      request.onsuccess = () => {
        resolve(request.result || [])
      }

      request.onerror = () => {
        reject(new Error('Failed to retrieve project sources from IndexedDB'))
      }
    })
  } catch (e) {
    console.error("IndexedDB getSourcesForProject initialization error:", e)
    return []
  }
}

export async function deleteSource(id: number): Promise<void> {
  const db = await initDB()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.delete(id)

    request.onsuccess = () => {
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
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      
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
