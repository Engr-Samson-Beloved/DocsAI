"use client"

import { useState, useEffect } from 'react'

/**
 * Custom hook to detect mobile screen sizes.
 * Returns true if the viewport width is <= 768px.
 * SSR-safe: defaults to false on server, hydrates on client.
 */
export function useIsMobile(breakpoint: number = 768): boolean {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    // Check initial state
    const mediaQuery = window.matchMedia(`(max-width: ${breakpoint}px)`)
    setIsMobile(mediaQuery.matches)

    // Listen for changes
    const handler = (e: MediaQueryListEvent) => {
      setIsMobile(e.matches)
    }

    mediaQuery.addEventListener('change', handler)
    return () => mediaQuery.removeEventListener('change', handler)
  }, [breakpoint])

  return isMobile
}
