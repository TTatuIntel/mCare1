import { useApp } from '@/shared/state/AppContext'

export function SuspendedScreen() {
  const { currentUser, setCurrentUser } = useApp()
  return (
    <div className="flex flex-col items-center justify-center h-full px-6 text-center gap-5">
      <div className="w-20 h-20 rounded-full flex items-center justify-center text-4xl bg-red-50">⛔</div>
      <div>
        <h2 className="text-xl font-bold text-gray-900 font-display">Account Suspended</h2>
        <p className="text-sm text-gray-500 mt-1">{currentUser?.name}</p>
      </div>
      <div className="w-full rounded-2xl p-4 border bg-red-50 border-red-200">
        <p className="text-sm leading-relaxed text-red-700">
          Your access to mCare has been suspended by an administrator. Contact support@matendocare.com to restore access.
          In an emergency, call your local emergency number.
        </p>
      </div>
      <button onClick={() => setCurrentUser(null)} className="text-xs text-gray-400">← Back to sign in</button>
    </div>
  )
}
