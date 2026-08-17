"use client"

/**
 * Admin dashboard.
 *
 * One page, four tabs, no build step of its own. It talks only to /api/admin/*,
 * every one of which re-checks the session cookie — nothing here is trusted to
 * have authorised itself, and signing out is a cookie clear rather than a state
 * flag.
 *
 * Deliberately plain. This is an operator surface used by one person; the
 * effort belongs in the numbers being correct, not in the chrome.
 */

import React, { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  BadgeCheck,
  ChevronRight,
  Coins,
  LayoutDashboard,
  ListFilter,
  LogOut,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  Users,
} from 'lucide-react'
import { PLANS, formatNaira, type PlanTier } from '../../utils/plans'

type Tab = 'overview' | 'accounts' | 'failures' | 'activity'

interface Subscriber {
  email: string
  userId: string | null
  planTier: PlanTier
  planName: string
  status: 'active' | 'expired' | 'free'
  amount: number
  expiresAt: string | null
  grantedBy: string | null
  note: string | null
  updatedAt: string | null
  used: Record<string, number>
  quotas: Record<string, number>
  lastSignInAt?: string | null
  createdAt?: string | null
}

interface FailureRow {
  id: string
  email: string | null
  feature: string
  stage: string
  message: string
  statusCode: number | null
  createdAt: number
}

interface UsageRow {
  id: string
  email: string | null
  feature: string
  planTier: string
  projectId: string | null
  quantity: number
  createdAt: number
}

interface Overview {
  totalAccounts: number
  activeSubscribers: number
  byTier: Record<PlanTier, number>
  monthlyRevenue: number
  compedAccounts: number
  usageLast30Days: Record<string, number>
  failuresLast7Days: number
  topFailureStage: string | null
}

const TIER_ORDER: PlanTier[] = ['free', 'basic', 'pro', 'enterprise']

function when(ts: number | string | null | undefined): string {
  if (!ts) return '—'
  const date = typeof ts === 'number' ? new Date(ts) : new Date(ts)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString()
}

/** `quota` panels read better as "3 / 6" than as two separate numbers. */
function ratio(used: number | undefined, limit: number | undefined): string {
  if (!limit) return '—'
  return `${used ?? 0} / ${limit}`
}

const STAGE_TONE: Record<string, string> = {
  quota: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  auth: 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300',
  upstream: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
  provider: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
  storage: 'bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300',
}

export default function AdminPage() {
  const [ready, setReady] = useState(false)
  const [signedIn, setSignedIn] = useState(false)
  const [adminEmail, setAdminEmail] = useState<string | null>(null)
  const [configured, setConfigured] = useState(true)
  const [missing, setMissing] = useState<string[]>([])

  const [tab, setTab] = useState<Tab>('overview')
  const [banner, setBanner] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const [overview, setOverview] = useState<Overview | null>(null)
  const [degraded, setDegraded] = useState<string | null>(null)
  const [users, setUsers] = useState<Subscriber[]>([])
  const [failures, setFailures] = useState<FailureRow[]>([])
  const [usage, setUsage] = useState<UsageRow[]>([])
  const [search, setSearch] = useState('')

  /* ── session ──────────────────────────────────────────────────── */

  const probeSession = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/login', { cache: 'no-store' })
      const body = await res.json()
      setSignedIn(Boolean(body.signedIn))
      setAdminEmail(body.email ?? null)
      setConfigured(Boolean(body.configured))
      setMissing(body.missing ?? [])
    } catch {
      setSignedIn(false)
    } finally {
      setReady(true)
    }
  }, [])

  useEffect(() => {
    probeSession()
  }, [probeSession])

  /* ── data ─────────────────────────────────────────────────────── */

  const loadOverview = useCallback(async () => {
    const res = await fetch('/api/admin/overview', { cache: 'no-store' })
    if (!res.ok) return
    const body = await res.json()
    setOverview(body.overview)
    setDegraded(body.degraded ? body.reason : null)
  }, [])

  const loadUsers = useCallback(async (term = '') => {
    const query = term ? `?search=${encodeURIComponent(term)}` : ''
    const res = await fetch(`/api/admin/users${query}`, { cache: 'no-store' })
    if (!res.ok) return
    const body = await res.json()
    setUsers(body.users ?? [])
    if (body.degraded) setDegraded(body.reason)
  }, [])

  const loadFailures = useCallback(async () => {
    const res = await fetch('/api/admin/failures?days=30&limit=200', { cache: 'no-store' })
    if (!res.ok) return
    setFailures((await res.json()).failures ?? [])
  }, [])

  const loadUsage = useCallback(async () => {
    const res = await fetch('/api/admin/usage?days=30&limit=200', { cache: 'no-store' })
    if (!res.ok) return
    setUsage((await res.json()).usage ?? [])
  }, [])

  const refresh = useCallback(async () => {
    setBusy(true)
    try {
      await Promise.all([loadOverview(), loadUsers(search), loadFailures(), loadUsage()])
    } finally {
      setBusy(false)
    }
  }, [loadOverview, loadUsers, loadFailures, loadUsage, search])

  useEffect(() => {
    if (signedIn) refresh()
  }, [signedIn, refresh])

  /* ── actions ──────────────────────────────────────────────────── */

  const signIn = async (email: string, password: string) => {
    setBusy(true)
    setBanner(null)
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Sign-in failed.')
      setSignedIn(true)
      setAdminEmail(body.email)
    } catch (err: any) {
      setBanner({ tone: 'error', text: err.message })
    } finally {
      setBusy(false)
    }
  }

  const signOut = async () => {
    await fetch('/api/admin/login', { method: 'DELETE' })
    setSignedIn(false)
    setAdminEmail(null)
    setOverview(null)
    setUsers([])
  }

  const post = async (payload: Record<string, unknown>, success: string) => {
    setBusy(true)
    setBanner(null)
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'That did not work.')
      setBanner({ tone: 'ok', text: body.warning ? `${success} ${body.warning}` : success })
      await refresh()
      return true
    } catch (err: any) {
      setBanner({ tone: 'error', text: err.message })
      return false
    } finally {
      setBusy(false)
    }
  }

  const refund = async (id: string) => {
    if (!window.confirm('Give this credit back to the user?')) return
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/usage?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Refund failed.')
      setBanner({ tone: 'ok', text: 'Credit refunded.' })
      await refresh()
    } catch (err: any) {
      setBanner({ tone: 'error', text: err.message })
    } finally {
      setBusy(false)
    }
  }

  /* ── screens ──────────────────────────────────────────────────── */

  if (!ready) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-zinc-50 dark:bg-zinc-950">
        <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!signedIn) {
    return <LoginScreen onSubmit={signIn} busy={busy} banner={banner} configured={configured} missing={missing} />
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      <header className="sticky top-0 z-20 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-600 text-white flex items-center justify-center">
              <ShieldAlert className="w-4 h-4" />
            </div>
            <div>
              <div className="text-sm font-bold leading-tight">WordPI Admin</div>
              <div className="text-[11px] text-zinc-500">{adminEmail}</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={refresh}
              disabled={busy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-xs font-bold disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              onClick={signOut}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-bold cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign out
            </button>
          </div>
        </div>

        <nav className="max-w-7xl mx-auto px-4 flex gap-1 overflow-x-auto">
          {([
            ['overview', 'Overview', LayoutDashboard],
            ['accounts', 'Accounts', Users],
            ['failures', 'Failures', AlertTriangle],
            ['activity', 'Activity', Coins],
          ] as [Tab, string, typeof Users][]).map(([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-bold border-b-2 -mb-px whitespace-nowrap cursor-pointer transition-colors ${
                tab === id
                  ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                  : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </nav>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-5">
        {degraded && (
          <div className="flex items-start gap-2.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 text-amber-800 dark:text-amber-300 rounded-2xl p-3.5 text-xs">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{degraded}</span>
          </div>
        )}

        {banner && (
          <div
            className={`flex items-start gap-2.5 rounded-2xl p-3.5 text-xs font-semibold border ${
              banner.tone === 'ok'
                ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900/50 text-emerald-800 dark:text-emerald-300'
                : 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900/50 text-red-800 dark:text-red-300'
            }`}
          >
            {banner.tone === 'ok' ? (
              <BadgeCheck className="w-4 h-4 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            )}
            <span>{banner.text}</span>
          </div>
        )}

        {tab === 'overview' && <OverviewTab overview={overview} />}

        {tab === 'accounts' && (
          <AccountsTab
            users={users}
            search={search}
            setSearch={setSearch}
            onSearch={() => loadUsers(search)}
            onGrant={(email, tier, days) =>
              post({ action: 'grant', email, tier, days }, `${email} is now on the ${PLANS[tier].name}.`)
            }
            onCreate={(email, password, tier) =>
              post({ action: 'create', email, password, tier }, `Account created for ${email}.`)
            }
            busy={busy}
          />
        )}

        {tab === 'failures' && <FailuresTab failures={failures} />}

        {tab === 'activity' && <ActivityTab usage={usage} onRefund={refund} busy={busy} />}
      </main>
    </div>
  )
}

/* ── login ──────────────────────────────────────────────────────── */

function LoginScreen({
  onSubmit,
  busy,
  banner,
  configured,
  missing,
}: {
  onSubmit: (email: string, password: string) => void
  busy: boolean
  banner: { tone: 'ok' | 'error'; text: string } | null
  configured: boolean
  missing: string[]
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 p-4">
      <form
        onSubmit={e => {
          e.preventDefault()
          onSubmit(email, password)
        }}
        className="w-full max-w-sm bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl p-6 space-y-5 shadow-sm"
      >
        <div className="text-center space-y-2">
          <div className="mx-auto w-11 h-11 rounded-2xl bg-indigo-600 text-white flex items-center justify-center">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">WordPI Admin</h1>
          <p className="text-xs text-zinc-500">Plans, accounts and failure history.</p>
        </div>

        {!configured && (
          <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 text-amber-800 dark:text-amber-300 rounded-xl p-3 text-xs">
            Not configured on this deployment. Set {missing.join(' and ')} in{' '}
            <code className="font-mono">.env.local</code> and restart.
          </div>
        )}

        {banner?.tone === 'error' && (
          <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 text-red-700 dark:text-red-300 rounded-xl p-3 text-xs font-semibold">
            {banner.text}
          </div>
        )}

        <div className="space-y-3">
          <input
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="Admin email"
            className="w-full text-sm px-3.5 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full text-sm px-3.5 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        <button
          type="submit"
          disabled={busy || !configured}
          className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-bold cursor-pointer transition-colors"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}

/* ── overview ───────────────────────────────────────────────────── */

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4">
      <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">{label}</div>
      <div className="text-2xl font-extrabold mt-1">{value}</div>
      {hint && <div className="text-[11px] text-zinc-500 mt-0.5">{hint}</div>}
    </div>
  )
}

function OverviewTab({ overview }: { overview: Overview | null }) {
  if (!overview) {
    return <div className="text-xs text-zinc-500">Loading…</div>
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Accounts" value={String(overview.totalAccounts)} />
        <Stat
          label="Active subscribers"
          value={String(overview.activeSubscribers)}
          hint={overview.compedAccounts ? `${overview.compedAccounts} comped` : undefined}
        />
        <Stat
          label="Monthly revenue"
          value={formatNaira(overview.monthlyRevenue)}
          hint="Comped accounts excluded"
        />
        <Stat
          label="Failures (7 days)"
          value={String(overview.failuresLast7Days)}
          hint={overview.topFailureStage ? `Most common: ${overview.topFailureStage}` : undefined}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4">
          <div className="text-xs font-bold mb-3">Accounts by plan</div>
          <div className="space-y-2">
            {TIER_ORDER.map(tier => (
              <div key={tier} className="flex items-center justify-between text-xs">
                <span className="font-semibold text-zinc-600 dark:text-zinc-300">
                  {PLANS[tier].name}
                  <span className="text-zinc-400 font-normal"> · {formatNaira(PLANS[tier].amount)}</span>
                </span>
                <span className="font-extrabold">{overview.byTier[tier] ?? 0}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4">
          <div className="text-xs font-bold mb-3">Credits spent (30 days)</div>
          <div className="space-y-2">
            {Object.entries(overview.usageLast30Days).map(([feature, count]) => (
              <div key={feature} className="flex items-center justify-between text-xs">
                <span className="font-semibold text-zinc-600 dark:text-zinc-300 capitalize">{feature}</span>
                <span className="font-extrabold">{count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── accounts ───────────────────────────────────────────────────── */

function AccountsTab({
  users,
  search,
  setSearch,
  onSearch,
  onGrant,
  onCreate,
  busy,
}: {
  users: Subscriber[]
  search: string
  setSearch: (v: string) => void
  onSearch: () => void
  onGrant: (email: string, tier: PlanTier, days?: number) => Promise<boolean>
  onCreate: (email: string, password: string, tier: PlanTier) => Promise<boolean>
  busy: boolean
}) {
  const [showAdd, setShowAdd] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newTier, setNewTier] = useState<PlanTier>('free')

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-zinc-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && onSearch()}
            placeholder="Search by email"
            className="w-full text-xs pl-9 pr-3 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <button
          onClick={onSearch}
          className="px-3.5 py-2.5 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-xs font-bold cursor-pointer"
        >
          Search
        </button>
        <button
          onClick={() => setShowAdd(v => !v)}
          className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          Add user
        </button>
      </div>

      {showAdd && (
        <form
          onSubmit={async e => {
            e.preventDefault()
            const ok = await onCreate(newEmail, newPassword, newTier)
            if (ok) {
              setNewEmail('')
              setNewPassword('')
              setNewTier('free')
              setShowAdd(false)
            }
          }}
          className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end"
        >
          <label className="space-y-1 sm:col-span-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Email</span>
            <input
              type="email"
              required
              value={newEmail}
              onChange={e => setNewEmail(e.target.value)}
              className="w-full text-xs px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Password</span>
            <input
              type="text"
              required
              minLength={6}
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              className="w-full text-xs px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Plan</span>
            <select
              value={newTier}
              onChange={e => setNewTier(e.target.value as PlanTier)}
              className="w-full text-xs px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 outline-none focus:ring-1 focus:ring-indigo-500"
            >
              {TIER_ORDER.map(tier => (
                <option key={tier} value={tier}>
                  {PLANS[tier].name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={busy}
            className="sm:col-span-4 py-2.5 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-bold disabled:opacity-50 cursor-pointer"
          >
            Create account
          </button>
        </form>
      )}

      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-zinc-50 dark:bg-zinc-800/50 text-zinc-500">
              <tr>
                <th className="text-left font-bold px-4 py-2.5">Account</th>
                <th className="text-left font-bold px-4 py-2.5">Plan</th>
                <th className="text-left font-bold px-4 py-2.5">Renews / expired</th>
                <th className="text-left font-bold px-4 py-2.5">Reports</th>
                <th className="text-left font-bold px-4 py-2.5">Humanize</th>
                <th className="text-left font-bold px-4 py-2.5">Decks</th>
                <th className="text-left font-bold px-4 py-2.5">Checks</th>
                <th className="text-left font-bold px-4 py-2.5">Change plan</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-zinc-400">
                    No accounts to show.
                  </td>
                </tr>
              )}
              {users.map(user => (
                <tr key={user.email} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="px-4 py-2.5">
                    <div className="font-semibold">{user.email}</div>
                    <div className="text-[10px] text-zinc-400">
                      {user.userId ? `Last seen ${when(user.lastSignInAt)}` : 'No Supabase account yet'}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-lg font-bold ${
                        user.status === 'active'
                          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                          : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
                      }`}
                    >
                      {user.planName}
                    </span>
                    {user.grantedBy && <div className="text-[10px] text-amber-600 mt-0.5">Comped</div>}
                  </td>
                  <td className="px-4 py-2.5 text-zinc-500">{when(user.expiresAt)}</td>
                  <td className="px-4 py-2.5 font-mono">{ratio(user.used.report, user.quotas.report)}</td>
                  <td className="px-4 py-2.5 font-mono">{ratio(user.used.humanize, user.quotas.humanize)}</td>
                  <td className="px-4 py-2.5 font-mono">{ratio(user.used.powerpoint, user.quotas.powerpoint)}</td>
                  <td className="px-4 py-2.5 font-mono">{ratio(user.used.integrity, user.quotas.integrity)}</td>
                  <td className="px-4 py-2.5">
                    <select
                      value={user.planTier}
                      disabled={busy}
                      onChange={e => onGrant(user.email, e.target.value as PlanTier)}
                      className="text-[11px] px-2 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 outline-none cursor-pointer"
                    >
                      {TIER_ORDER.map(tier => (
                        <option key={tier} value={tier}>
                          {PLANS[tier].name}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-zinc-400 flex items-center gap-1">
        <ChevronRight className="w-3 h-3" />
        Changing a plan here grants a full 30-day cycle with a fresh set of credits, and marks the
        account as comped so it is left out of revenue.
      </p>
    </div>
  )
}

/* ── failures ───────────────────────────────────────────────────── */

function FailuresTab({ failures }: { failures: FailureRow[] }) {
  const [stage, setStage] = useState<string>('all')
  const stages = Array.from(new Set(failures.map(f => f.stage)))
  const shown = stage === 'all' ? failures : failures.filter(f => f.stage === stage)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <ListFilter className="w-3.5 h-3.5 text-zinc-400" />
        {['all', ...stages].map(value => (
          <button
            key={value}
            onClick={() => setStage(value)}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer ${
              stage === value
                ? 'bg-indigo-600 text-white'
                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300'
            }`}
          >
            {value}
          </button>
        ))}
        <span className="text-[11px] text-zinc-400 ml-auto">
          {shown.length} in the last 30 days · <code className="font-mono">quota</code> means someone hit
          the paywall
        </span>
      </div>

      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-zinc-50 dark:bg-zinc-800/50 text-zinc-500">
              <tr>
                <th className="text-left font-bold px-4 py-2.5">When</th>
                <th className="text-left font-bold px-4 py-2.5">Account</th>
                <th className="text-left font-bold px-4 py-2.5">Feature</th>
                <th className="text-left font-bold px-4 py-2.5">Stage</th>
                <th className="text-left font-bold px-4 py-2.5">What happened</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-zinc-400">
                    Nothing recorded.
                  </td>
                </tr>
              )}
              {shown.map(failure => (
                <tr key={failure.id} className="border-t border-zinc-100 dark:border-zinc-800 align-top">
                  <td className="px-4 py-2.5 text-zinc-500 whitespace-nowrap">{when(failure.createdAt)}</td>
                  <td className="px-4 py-2.5 font-semibold">{failure.email ?? '—'}</td>
                  <td className="px-4 py-2.5 capitalize">{failure.feature}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-lg font-bold ${
                        STAGE_TONE[failure.stage] ?? 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'
                      }`}
                    >
                      {failure.stage}
                      {failure.statusCode ? ` ${failure.statusCode}` : ''}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-zinc-600 dark:text-zinc-300 max-w-lg">{failure.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

/* ── activity ───────────────────────────────────────────────────── */

function ActivityTab({
  usage,
  onRefund,
  busy,
}: {
  usage: UsageRow[]
  onRefund: (id: string) => void
  busy: boolean
}) {
  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-zinc-50 dark:bg-zinc-800/50 text-zinc-500">
            <tr>
              <th className="text-left font-bold px-4 py-2.5">When</th>
              <th className="text-left font-bold px-4 py-2.5">Account</th>
              <th className="text-left font-bold px-4 py-2.5">Feature</th>
              <th className="text-left font-bold px-4 py-2.5">Plan at the time</th>
              <th className="text-left font-bold px-4 py-2.5">Units</th>
              <th className="text-right font-bold px-4 py-2.5">Refund</th>
            </tr>
          </thead>
          <tbody>
            {usage.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-zinc-400">
                  No credits spent in the last 30 days.
                </td>
              </tr>
            )}
            {usage.map(row => (
              <tr key={row.id} className="border-t border-zinc-100 dark:border-zinc-800">
                <td className="px-4 py-2.5 text-zinc-500 whitespace-nowrap">{when(row.createdAt)}</td>
                <td className="px-4 py-2.5 font-semibold">{row.email ?? '—'}</td>
                <td className="px-4 py-2.5 capitalize">{row.feature}</td>
                <td className="px-4 py-2.5 text-zinc-500">{PLANS[row.planTier as PlanTier]?.name ?? row.planTier}</td>
                <td className="px-4 py-2.5 font-mono">{row.quantity}</td>
                <td className="px-4 py-2.5 text-right">
                  <button
                    onClick={() => onRefund(row.id)}
                    disabled={busy}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 font-bold disabled:opacity-50 cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Give back
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
