import { useState } from 'react'
import { useApp } from '@/shared/state/AppContext'
import { SOCIAL_PROVIDERS, isEmail, type ProviderStyle } from '@/shared/state/auth'
import { BottomSheet } from '@/shared/ui/BottomSheet'
import { backendConfigured } from '@/shared/api/supabase'
import { providerAvailable, rememberConsent, startProviderSignIn } from '@/shared/api/authBackend'
import { appBaseUrl } from '@/shared/email/emailTemplate'
import { AuthButton, AuthField, authInputCls } from './authKit'
import { Consent } from './Legal'

function ProviderMark({ mark, outline, className = 'w-[18px] h-[18px]' }: { mark: string; outline?: boolean; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true"
      {...(outline ? { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const } : { fill: 'currentColor' })}>
      {mark.split('|').map(d => <path key={d} d={d} />)}
    </svg>
  )
}

/**
 * "Continue with Google / Apple / Facebook / Instagram / X / Yahoo": one compact row, so the sign-in page never scrolls. Signs in an existing account or
 * creates a patient on first use (`socialAuth`).
 *
 * Live mode (backend keys set): after the Terms are accepted the browser goes
 * to the provider's own sign-in window, and LoginScreen opens the account when
 * it comes back. Only providers the backend supports are shown.
 * Demo mode: a sheet stands in for the provider and asks for the name and
 * email it would hand back.
 */
const PROVIDERS = SOCIAL_PROVIDERS.filter(p => providerAvailable(p.id))
/** Six fit one row in demo mode; live mode shows the connected ones only. */
const GRID = PROVIDERS.length === SOCIAL_PROVIDERS.length ? 'grid-cols-6' : 'grid-cols-4'

export function SocialButtons() {
  const { socialAuth, setCurrentUser, updateUser } = useApp()
  const [provider, setProvider] = useState<ProviderStyle | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [error, setError] = useState('')
  const [leaving, setLeaving] = useState(false)

  const ready = agreed && (backendConfigured || isEmail(email)) && !leaving

  const submit = async () => {
    if (!provider || !ready) return
    if (backendConfigured) {
      rememberConsent()
      setLeaving(true)
      const failed = await startProviderSignIn(provider.id, appBaseUrl())
      // On success the page is already navigating away; only a failure lands here.
      if (failed) { setError(failed); setLeaving(false) }
      return
    }
    const res = socialAuth(provider.id, email, name)
    if (!res.ok || !res.user) { setError(res.error ?? 'Could not sign you in. Please try again.'); return }
    if (res.isNew) updateUser(res.user.id, { termsAcceptedAt: Date.now() })
    setProvider(null)
    setCurrentUser(res.user)
  }

  return (
    <>
      <div className={`grid ${GRID} gap-1 @2xl:gap-1.5 @5xl:gap-2`}>
        {PROVIDERS.map(p => (
          <button key={p.id} type="button" onClick={() => { setProvider(p); setError('') }} aria-label={`Continue with ${p.label}`}
            title={p.label}
            className={`h-9 @2xl:h-10 @5xl:h-11 rounded-xl @2xl:rounded-2xl border flex items-center justify-center transition-all hover:-translate-y-0.5 hover:shadow-sm @2xl:hover:shadow-md active:scale-[.97] ${p.bg} ${p.border} ${p.text}`}>
            <ProviderMark mark={p.mark} outline={p.outline} className="w-[16px] h-[16px] @2xl:w-[18px] @2xl:h-[18px]" />
          </button>
        ))}
      </div>

      <BottomSheet open={!!provider} onClose={() => setProvider(null)}
        title={`Continue with ${provider?.label ?? ''}`}
        subtitle={backendConfigured
          ? `You will sign in on ${provider?.label ?? 'the provider'}’s own page, then come straight back.`
          : `Demo mode: this stands in for ${provider?.label ?? 'the provider'}’s own sign-in window.`}>
        {/* stopPropagation: React bubbles this through the portal to the sign-in form the buttons sit in. */}
        <form className="flex flex-col gap-3 pb-2" onSubmit={e => { e.preventDefault(); e.stopPropagation(); submit() }}>
          {!backendConfigured && <>
          <AuthField label={`${provider?.label ?? ''} account email`}>
            <input type="email" autoComplete="email" value={email} onChange={e => { setEmail(e.target.value); setError('') }}
              placeholder="you@example.com" className={authInputCls} />
          </AuthField>
          <AuthField label="Name (new accounts)">
            <input type="text" autoComplete="name" value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. Grace Otieno" className={authInputCls} />
          </AuthField>
          </>}
          <Consent checked={agreed} onChange={setAgreed} />
          {error && <p role="alert" className="auth-shake text-xs text-red-500 text-center">{error}</p>}
          <AuthButton type="submit" disabled={!ready}>{leaving ? 'Opening…' : 'Continue'}</AuthButton>
        </form>
      </BottomSheet>
    </>
  )
}
