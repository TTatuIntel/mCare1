import { useState } from 'react'
import type { PublicDoctor } from './usePatient'
import { Avatar, HERO_GRADIENT } from '@/shared'

/* ─── Doctor Profile Sheet ───────────────────────────────────────────── */
export function DoctorProfileSheet({ doctor, isAssigned, onClose }: {
  doctor: PublicDoctor; isAssigned: boolean; onClose: () => void
}) {
  const [rating, setRating] = useState(0)
  const [hovered, setHovered] = useState(0)
  const [submitted, setSubmitted] = useState(false)

  function submitRating() {
    setSubmitted(true)
    setTimeout(() => setSubmitted(false), 2000)
  }

  return (
    <>
      <div className="absolute inset-0 bg-black/40 z-40 sheet-fade" onClick={onClose} />
      <div className="absolute bottom-0 left-0 right-0 z-50 bg-white sheet-up" style={{ borderRadius: '24px 24px 0 0' }}>
        {/* Teal header band */}
        <div className="rounded-t-3xl px-5 pt-5 pb-6" style={{ background: HERO_GRADIENT }}>
          <div className="w-10 h-1 bg-white/30 rounded-full mx-auto mb-4" />
          <div className="flex items-center gap-4">
            <Avatar name={doctor.name} avatar={doctor.avatar} size="md" />
            <div className="flex-1 min-w-0">
              <p className="text-base font-bold text-white">{doctor.name}</p>
              <p className="text-xs text-white/80 font-medium">{doctor.specialty}</p>
              <p className="text-[10px] text-white/60 mt-0.5">{doctor.hospital}</p>
            </div>
            {isAssigned && (
              <span className="text-[9px] bg-white/20 text-white font-bold px-2 py-1 rounded-full flex-shrink-0">
                Your Doctor
              </span>
            )}
          </div>
        </div>

        <div className="px-5 pt-4 pb-5 flex flex-col gap-4">
          {/* Contact info */}
          <div className="bg-gray-50 rounded-2xl overflow-hidden">
            <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider px-4 pt-3 pb-1">Contact Info</p>
            {[
              { icon: '✉️', label: 'Email', value: doctor.email },
              { icon: '📞', label: 'Phone', value: doctor.phone },
              { icon: '🏥', label: 'Hospital', value: doctor.hospital },
              { icon: '🪪', label: 'License No.', value: doctor.licenseNo },
            ].map((row, i, arr) => (
              <div key={row.label}
                className={`flex items-center gap-3 px-4 py-2.5 ${i < arr.length - 1 ? 'border-b border-gray-100' : ''}`}>
                <span className="text-base w-6 text-center">{row.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[9px] text-gray-400 uppercase tracking-wide">{row.label}</p>
                  <p className="text-xs font-semibold text-gray-800 truncate">{row.value}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Rate doctor */}
          <div className="bg-gray-50 rounded-2xl p-4">
            <p className="text-xs font-bold text-gray-800 mb-1">Rate this Doctor</p>
            <p className="text-[10px] text-gray-400 mb-3">Your feedback helps improve care quality.</p>
            {submitted ? (
              <div className="flex items-center justify-center gap-2 py-2">
                <span className="text-lg">✅</span>
                <p className="text-sm font-bold text-teal-700">Thank you for your rating!</p>
              </div>
            ) : (
              <>
                <div className="flex gap-2 justify-center mb-3">
                  {[1, 2, 3, 4, 5].map(star => (
                    <button key={star}
                      onMouseEnter={() => setHovered(star)}
                      onMouseLeave={() => setHovered(0)}
                      onClick={() => setRating(star)}
                      className="text-3xl transition-transform active:scale-110">
                      {star <= (hovered || rating) ? '⭐' : '☆'}
                    </button>
                  ))}
                </div>
                {rating > 0 && (
                  <p className="text-center text-[10px] text-gray-500 mb-2">
                    {['', 'Poor', 'Fair', 'Good', 'Very Good', 'Excellent'][rating]}
                  </p>
                )}
                <button
                  onClick={submitRating}
                  disabled={rating === 0}
                  className={`w-full py-2.5 text-sm font-bold rounded-xl transition-colors ${
                    rating > 0 ? 'bg-teal-700 text-white' : 'bg-gray-200 text-gray-400'
                  }`}>
                  Submit Rating
                </button>
              </>
            )}
          </div>

          <button onClick={onClose}
            className="w-full py-3 bg-gray-100 text-gray-600 text-sm font-semibold rounded-xl">
            Close
          </button>
        </div>
      </div>
    </>
  )
}
