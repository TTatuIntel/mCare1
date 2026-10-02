import { useEffect, useState } from 'react'
import { usePatient, type PublicDoctor } from './usePatient'
import { Avatar, BottomSheet, SheetButton, SaveError, useSave, inputCls } from '@/shared'

const WORDS = ['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent']

/* ─── Doctor profile ──────────────────────────────────────────────────
   Who the doctor is and how to reach them. A patient can rate the doctor
   who treats them; the rating is saved and can be changed later. Other
   people only ever see the average. */
export function DoctorProfileSheet({ doctor, isAssigned, onClose }: {
  doctor: PublicDoctor; isAssigned: boolean; onClose: () => void
}) {
  const { myRating, rateDoctor, ratingSummary } = usePatient()
  const mine = myRating(doctor.id)
  const [rating, setRating] = useState(mine?.rating ?? 0)
  const [comment, setComment] = useState(mine?.comment ?? '')
  const [saved, setSaved] = useState(false)
  const save = useSave()
  /** What every patient may see: the average and how many rated. Null until known. */
  const [summary, setSummary] = useState<{ average: number | null; ratings: number } | null>(null)

  // Asked again after the patient's own rating changes, so the average shown includes it.
  useEffect(() => {
    let stale = false
    ratingSummary(doctor.id).then(s => { if (!stale) setSummary(s) })
    return () => { stale = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doctor.id, mine?.rating])

  const changed = rating !== (mine?.rating ?? 0) || comment.trim() !== (mine?.comment ?? '')
  const submit = async () => {
    if (!(await save.run(() => rateDoctor(doctor.id, rating, comment))).ok) return
    setSaved(true)
  }

  const rows = [
    { icon: '✉️', label: 'Email', value: doctor.email, href: `mailto:${doctor.email}` },
    { icon: '📞', label: 'Phone', value: doctor.phone, href: doctor.phone ? `tel:${doctor.phone.replace(/\s/g, '')}` : undefined },
    { icon: '🏥', label: 'Hospital', value: doctor.hospital },
    { icon: '🪪', label: 'Licence No.', value: doctor.licenseNo },
  ].filter(r => r.value)

  return (
    <BottomSheet open onClose={onClose} title={doctor.name} subtitle={[doctor.specialty, doctor.hospital].filter(Boolean).join(' · ')}
      footer={<SheetButton tone="ghost" onClick={onClose}>Close</SheetButton>}>
      <div className="flex items-center gap-3 mb-4">
        <Avatar name={doctor.name} avatar={doctor.avatar} size="md" />
        <div className="flex-1 min-w-0">
          {isAssigned && <span className="text-[10px] bg-teal-50 text-teal-700 font-bold px-2 py-1 rounded-full">Your doctor</span>}
          <p className="text-xs text-gray-500 mt-1.5">
            {summary?.average
              ? <><span className="font-mono font-bold text-gray-900">{summary.average}</span> ★ from <span className="font-mono">{summary.ratings}</span> patient{summary.ratings === 1 ? '' : 's'}</>
              : 'No ratings yet'}
          </p>
        </div>
      </div>

      <div className="bg-gray-50 rounded-2xl overflow-hidden mb-4">
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider px-4 pt-3 pb-1">Contact</p>
        {rows.map((row, i) => (
          <div key={row.label} className={`flex items-center gap-3 px-4 py-2.5 ${i < rows.length - 1 ? 'border-b border-gray-100' : ''}`}>
            <span className="text-base w-6 text-center" aria-hidden="true">{row.icon}</span>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] text-gray-400 uppercase tracking-wide">{row.label}</p>
              {row.href
                ? <a href={row.href} className="block text-xs font-semibold text-teal-700 truncate">{row.value}</a>
                : <p className="text-xs font-semibold text-gray-800 truncate">{row.value}</p>}
            </div>
          </div>
        ))}
      </div>

      {/* Only the doctor who treats this patient can be rated. */}
      {isAssigned ? (
        <div className="bg-gray-50 rounded-2xl p-4">
          <p className="text-xs font-bold text-gray-800">{mine ? 'Your rating' : 'Rate your doctor'}</p>
          <p className="text-[10px] text-gray-400 mb-3">Only the average is shown to others. You can change it at any time.</p>
          <div className="flex gap-2 justify-center mb-1" role="radiogroup" aria-label="Rating">
            {[1, 2, 3, 4, 5].map(star => (
              <button key={star} role="radio" aria-checked={rating === star} aria-label={`${star} star${star > 1 ? 's' : ''}: ${WORDS[star]}`}
                onClick={() => { setRating(star); setSaved(false) }}
                className={`text-3xl leading-none transition-transform active:scale-110 ${star <= rating ? 'text-amber-400' : 'text-gray-300'}`}>
                ★
              </button>
            ))}
          </div>
          <p className="text-center text-[11px] text-gray-500 h-4 mb-2">{WORDS[rating]}</p>
          <textarea rows={2} value={comment} maxLength={1000} onChange={e => { setComment(e.target.value); setSaved(false) }}
            placeholder="Anything you'd like to add (optional)" className={`${inputCls} resize-none bg-white`} />
          <SaveError message={save.error} className="mt-2" />
          <button onClick={submit} disabled={rating === 0 || !changed || save.busy}
            className={`w-full mt-2 py-2.5 text-sm font-bold rounded-xl transition-colors ${rating > 0 && changed && !save.busy ? 'bg-teal-700 text-white' : 'bg-gray-200 text-gray-400'}`}>
            {save.busy ? 'Saving…' : saved && !changed ? '✓ Rating saved' : mine ? 'Update rating' : 'Save rating'}
          </button>
        </div>
      ) : (
        <p className="text-[11px] text-gray-400 text-center">You can rate a doctor once they are treating you.</p>
      )}
    </BottomSheet>
  )
}
