/**
 * Deprecated endpoint.
 *
 * PDF export now happens entirely client-side (see utils/clientPdf.ts via
 * the editor's export action), so this server route is no longer used. It
 * is kept as a harmless stub to avoid a dangling import; safe to delete.
 */

export const runtime = 'nodejs'

export async function POST() {
  return new Response(
    'PDF export is now generated client-side; this endpoint is no longer used.',
    { status: 410, headers: { 'Content-Type': 'text/plain' } }
  )
}
