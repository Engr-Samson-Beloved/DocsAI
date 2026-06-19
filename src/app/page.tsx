"use client"

import dynamic from 'next/dynamic'

// Dynamically import the Editor component to prevent server-side rendering errors.
// Tiptap and other rich-text libraries require direct access to client-side DOM objects.
const Editor = dynamic(() => import('@/components/Editor/Editor'), {
  ssr: false,
  loading: () => (
    <div className="flex flex-col items-center justify-center flex-1 h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="flex flex-col items-center gap-3">
        <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
        <span className="text-zinc-600 dark:text-zinc-400 font-medium text-sm">Bootstrapping Editor...</span>
      </div>
    </div>
  )
})

export default function Home() {
  return (
    <main className="flex-1 flex flex-col h-screen">
      <Editor />
    </main>
  )
}
