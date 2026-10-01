import { useState } from 'react'
import { BottomSheet, SheetButton } from '@/shared/ui/BottomSheet'

/* Plain-language summary shown at sign-up. Replace with the reviewed legal text before launch. */
const TERMS: { title: string; body: string }[] = [
  { title: 'Using mCare', body: 'mCare helps you record your health readings, follow your medication and stay in touch with your care team. It supports your care; it does not replace a doctor’s judgement.' },
  { title: 'Emergencies', body: 'The SOS button alerts your care team and contacts, but it is not an emergency service. In a life-threatening situation, call your local emergency number.' },
  { title: 'Your account', body: 'Keep your password and codes to yourself, give accurate information, and tell us if you think someone else has used your account.' },
  { title: 'Fair use', body: 'Do not use mCare to harm others, to access records that are not yours, or to interfere with the service. Accounts that do may be suspended.' },
]
const PRIVACY: { title: string; body: string }[] = [
  { title: 'What we keep', body: 'Your account details, the readings and notes you enter, your medication and appointments, and messages with your care team.' },
  { title: 'Who can see it', body: 'You, the doctors assigned to you and the care staff who support them. Access depends on each person’s role and is recorded in an audit trail.' },
  { title: 'Messages we send', body: 'We email or text you sign-in codes, security notices and care alerts. We do not sell your information or use it for advertising.' },
  { title: 'Your choices', body: 'You can correct your details, choose what documents you share, and ask for your account to be closed from your profile.' },
]

function LegalSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<'terms' | 'privacy'>('terms')
  return (
    <BottomSheet open={open} onClose={onClose} title="Terms & Privacy Policy" subtitle="The short version, in plain language"
      footer={<SheetButton onClick={onClose}>Done</SheetButton>}>
      <div className="flex gap-1 rounded-xl bg-gray-100 p-1 mb-3" role="tablist">
        {(['terms', 'privacy'] as const).map(t => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={`flex-1 rounded-lg py-2 text-xs font-bold transition-colors ${tab === t ? 'bg-white text-teal-700 shadow-sm' : 'text-gray-500'}`}>
            {t === 'terms' ? 'Terms of Use' : 'Privacy Policy'}
          </button>
        ))}
      </div>
      <div key={tab} className="screen-in flex flex-col gap-3">
        {(tab === 'terms' ? TERMS : PRIVACY).map(s => (
          <div key={s.title}>
            <p className="text-xs font-bold text-gray-900">{s.title}</p>
            <p className="mt-0.5 text-xs text-gray-500 leading-relaxed">{s.body}</p>
          </div>
        ))}
      </div>
    </BottomSheet>
  )
}

/** "I agree to the Terms & Privacy Policy" checkbox; the link opens the text in a sheet. */
export function Consent({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <div className={`flex items-center gap-2.5 rounded-2xl px-4 h-11 transition-colors ${checked ? 'bg-teal-50' : 'bg-gray-50'}`}>
        <input id="auth-consent" type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
          className="w-4 h-4 shrink-0 accent-teal-700" />
        <p className="text-xs text-gray-600">
          <label htmlFor="auth-consent">I agree to the </label>
          <button type="button" onClick={() => setOpen(true)} className="font-semibold text-teal-700 underline underline-offset-2">
            Terms &amp; Privacy Policy
          </button>
        </p>
      </div>
      <LegalSheet open={open} onClose={() => setOpen(false)} />
    </>
  )
}
