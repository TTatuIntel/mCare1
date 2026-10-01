import { useEffect, useState } from 'react'
import { useApp } from '@/shared/state/AppContext'
import { Avatar, Pill } from '@/shared/ui/primitives'
import { BottomSheet } from '@/shared/ui/BottomSheet'
import { Loading } from '@/shared/ui/Loader'
import type { AppUser } from '@/shared/lib/types'
import { backendConfigured } from '@/shared/api/supabase'
import { mayHaveSession, resumeBackendSession, returningFromProvider, returningToReset, signInWithEmail } from '@/shared/api/authBackend'
import { AuthShell } from './AuthShell'
import { AuthBack, AuthButton, AuthDivider, AuthField, AuthHeading, IconInput, PasswordInput, authInputCls } from './authKit'
import { ForgotPassword } from './ForgotPassword'
import { ConfirmEmail, LiveRecovery, useAdoptAccount } from './LiveAuth'
import { SocialButtons } from './SocialAuth'
import { SelfRegisterScreen } from './SelfRegisterScreen'
import { WelcomeScreen } from './WelcomeScreen'

/** Role colours are identity markers only (same as ProfileCard); actions stay teal. */
const ROLE_PILL: Record<string, string> = { patient: 'teal', doctor: 'blue', admin: 'purple', assistant: 'purple' }

type View = 'welcome' | 'signin' | 'register' | 'forgot' | 'confirm'

/** Signed-out flow on one page: the card swaps between Welcome, Sign in, Create account and Forgot password. */
export function LoginScreen() {
  const adopt = useAdoptAccount()
  const [view, setView] = useState<View>('welcome')
  // Live mode: someone already signed in, or coming back from a provider or an emailed link, is let in here.
  const [resuming, setResuming] = useState(returningFromProvider || mayHaveSession)
  const [notice, setNotice] = useState('')
  /** Arrived by the emailed reset link: proven, but must choose a new password before going in. */
  const [recovered, setRecovered] = useState<AppUser>()
  const [demoOpen, setDemoOpen] = useState(false)
  // Carried between Sign in and Forgot password so the email is typed once.
  const [email, setEmail] = useState('')

  const signIn = (withDemo = false) => { setDemoOpen(withDemo && !backendConfigured); setView('signin') }

  useEffect(() => {
    let cancelled = false
    resumeBackendSession().then(session => {
      if (cancelled) return
      setResuming(false)
      if (session.ok && returningToReset) { setRecovered(session.user); setView('forgot') }
      else if (session.ok) adopt(session.user)
      else if (session.error) { setNotice(session.error); setView('signin') }
    })
    return () => { cancelled = true }
    // Runs once: it reads the session this page loaded with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <AuthShell welcome={view === 'welcome'} entrance onHome={() => setView('welcome')}>
      <Loading when={resuming} label="Signing you in…" />
      <div key={view} className="screen-in">
        {view === 'welcome' && (
          <WelcomeScreen onGetStarted={() => setView('register')} onSignIn={() => signIn()} onDemo={() => signIn(true)} />
        )}
        {view === 'register' && (
          <SelfRegisterScreen onSignIn={() => signIn()}
            onConfirm={sentTo => { setEmail(sentTo); setView('confirm') }} />
        )}
        {view === 'signin' && (
          <SignInForm initialDemoOpen={demoOpen} initialEmail={email} notice={notice} onBack={() => setView('welcome')} onRegister={() => setView('register')}
            onForgot={typed => { setEmail(typed); setView('forgot') }}
            onUnconfirmed={typed => { setEmail(typed); setView('confirm') }} />
        )}
        {view === 'forgot' && (backendConfigured
          ? <LiveRecovery initialEmail={email} recovered={recovered} onBack={() => signIn()} />
          : <ForgotPassword initialEmail={email} onBack={() => signIn()} onDone={found => { setEmail(found); signIn() }} />
        )}
        {view === 'confirm' && <ConfirmEmail email={email} onBack={() => signIn()} />}
      </div>
    </AuthShell>
  )
}

function SignInForm({ initialDemoOpen, initialEmail, notice, onBack, onRegister, onForgot, onUnconfirmed }: {
  /** Live mode: the password was right but the email has not been confirmed yet. */
  onUnconfirmed: (email: string) => void
  /** A problem carried in from provider sign-in, shown until the user types. */
  notice: string
  initialDemoOpen: boolean; initialEmail: string; onBack: () => void; onRegister: () => void
  /** Opens password recovery, carrying over whatever email is typed. */
  onForgot: (email: string) => void
}) {
  const { users, setCurrentUser, logAudit } = useApp()
  const [email, setEmail]       = useState(initialEmail)
  const [password, setPassword] = useState('')
  const [error, setError]       = useState(notice)
  const [showDemo, setShowDemo] = useState(initialDemoOpen)
  const [busy, setBusy] = useState(false)
  const adopt = useAdoptAccount()

  const ready = !!email.trim() && !!password && !busy

  const handleLogin = async () => {
    if (!ready) return
    if (backendConfigured) {
      setBusy(true)
      const res = await signInWithEmail(email, password)
      setBusy(false)
      if (res.ok) adopt(res.user)
      else if ('unconfirmed' in res) onUnconfirmed(email.trim())
      else setError(res.error ?? 'Could not sign you in. Please try again.')
      return
    }
    const user = users.find(u => u.email.toLowerCase() === email.trim().toLowerCase())
    if (!user)                { setError('No account found with this email address.'); return }
    if (user.password !== password) { setError('Incorrect password. Please try again.'); return }
    logAudit('Signed in', `${user.name} · Email & Password`)
    setCurrentUser(user)
  }

  return (
    <form className="auth-stagger flex flex-col gap-3.5" onSubmit={e => { e.preventDefault(); handleLogin() }}>
      <AuthBack onClick={onBack} />
      <AuthHeading center title="Welcome back" subtitle="Sign in to continue your care." />

      <AuthField label="Email Address">
        <IconInput icon="mail">
          <input
            type="email" autoComplete="username"
            value={email}
            onChange={e => { setEmail(e.target.value); setError('') }}
            placeholder="you@example.com"
            className={`${authInputCls} pl-10`}
          />
        </IconInput>
      </AuthField>

      <AuthField label="Password">
        <PasswordInput value={password} onChange={v => { setPassword(v); setError('') }}
          placeholder="Enter your password" autoComplete="current-password" />
      </AuthField>
      <button type="button" onClick={() => onForgot(email.trim())} className="self-end -mt-2 text-xs font-semibold text-teal-700 underline-offset-4 hover:underline">
        Forgot password?
      </button>

      {error && <p role="alert" className="auth-shake text-xs text-red-500 text-center">{error}</p>}

      <AuthButton type="submit" disabled={!ready}>{busy ? 'Signing in…' : 'Sign In'}</AuthButton>

      <AuthDivider>Or continue with</AuthDivider>
      <SocialButtons />

      {/* One line, so the whole form fits the screen without scrolling. */}
      <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-gray-600">
        <span>
          New here?{' '}
          <button type="button" onClick={onRegister} className="font-bold text-teal-700 underline underline-offset-4 hover:text-teal-800">Create an account</button>
        </span>
        {!backendConfigured && <>
          <span aria-hidden className="h-3 w-px bg-gray-300" />
          <button type="button" onClick={() => setShowDemo(true)} className="font-semibold text-teal-700 underline-offset-4 hover:underline">Demo accounts</button>
        </>}
      </p>

      <BottomSheet open={showDemo} onClose={() => setShowDemo(false)} title="Demo accounts"
        subtitle={<>Tap any account to fill it in · Password for all: <span className="font-mono font-bold text-gray-700">mcare123</span></>}>
        <div className="border border-gray-100 rounded-xl overflow-hidden">
          {users.map(u => (
            <button
              key={u.id} type="button"
              onClick={() => { setEmail(u.email); setPassword('mcare123'); setError(''); setShowDemo(false) }}
              className="w-full flex items-center gap-3 px-3 py-2.5 border-b border-gray-50 last:border-0 text-left transition-colors hover:bg-gray-50 active:bg-gray-50"
            >
              <Avatar name={u.name} avatar={u.avatar} size="xs" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-gray-900">{u.name}</p>
                <p className="text-[10px] text-gray-400 truncate">{u.email}</p>
              </div>
              <Pill color={ROLE_PILL[u.role]}>{u.role}</Pill>
            </button>
          ))}
        </div>
      </BottomSheet>
    </form>
  )
}
