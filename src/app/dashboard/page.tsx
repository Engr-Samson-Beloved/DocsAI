import { redirect } from 'next/navigation'

interface DashboardPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function DashboardRedirectPage({ searchParams }: DashboardPageProps) {
  const params = await searchParams
  const queryParts: string[] = []

  if (params) {
    Object.entries(params).forEach(([key, val]) => {
      if (Array.isArray(val)) {
        val.forEach(v => queryParts.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`))
      } else if (val !== undefined) {
        queryParts.push(`${encodeURIComponent(key)}=${encodeURIComponent(val)}`)
      }
    })
  }

  const queryString = queryParts.length > 0 ? `?${queryParts.join('&')}` : ''
  
  // Redirect to main application route with search query params intact
  redirect(`/${queryString}`)
}
