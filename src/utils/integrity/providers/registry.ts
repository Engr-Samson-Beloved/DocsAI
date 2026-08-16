/**
 * The provider registry.
 *
 * This is the only file that names the concrete providers. The engine, the
 * routes, the dashboard and the report all ask the registry for whatever is
 * available and iterate — so adding Turnitin or Originality.ai is a new file
 * next to this one plus a line in `ALL_PROVIDERS`, and no consumer changes.
 *
 * Registration is a plain array rather than a decorator or a dynamic import
 * scan on purpose: everything here has to survive Next's bundler, and a static
 * list is the shape that reliably does.
 */

import type { IntegrityProvider } from '../types'
import { CopyleaksProvider } from './copyleaks'
import { GPTZeroProvider } from './gptzero'

/** Every adapter the build knows about, configured or not. */
export const ALL_PROVIDERS: IntegrityProvider[] = [
  new CopyleaksProvider(),
  new GPTZeroProvider(),
]

/** Adapters whose credentials are actually present on this deployment. */
export function configuredProviders(): IntegrityProvider[] {
  return ALL_PROVIDERS.filter(provider => provider.isConfigured())
}

/** The first configured provider that can run a similarity scan, if any. */
export function plagiarismProvider(): IntegrityProvider | null {
  return (
    configuredProviders().find(
      provider => provider.supportsPlagiarism() && typeof provider.checkPlagiarism === 'function'
    ) ?? null
  )
}

export function providerById(id: string): IntegrityProvider | null {
  return ALL_PROVIDERS.find(provider => provider.id === id) ?? null
}

/**
 * What the client is allowed to know about provider availability.
 *
 * Deliberately not the credentials themselves, and not the reason a provider
 * is unconfigured — "COPYLEAKS_API_KEY is missing" is deployment detail that
 * §3 keeps off the wire.
 */
export interface ProviderAvailability {
  id: string
  label: string
  configured: boolean
  supportsPlagiarism: boolean
}

export function providerAvailability(): ProviderAvailability[] {
  return ALL_PROVIDERS.map(provider => ({
    id: provider.id,
    label: provider.label,
    configured: provider.isConfigured(),
    supportsPlagiarism: provider.supportsPlagiarism(),
  }))
}
