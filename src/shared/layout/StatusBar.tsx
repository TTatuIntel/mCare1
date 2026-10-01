/** Fake iOS status bar drawn at the top of the phone frame. */
export function StatusBar() {
  return (
    <div className="flex items-center justify-between px-6 pt-[14px] pb-2 bg-white flex-shrink-0">
      <span className="text-[12px] font-bold text-gray-900 tracking-tight font-mono">9:41</span>
      <div className="w-[120px] h-[32px] bg-black rounded-full" />
      <div className="flex items-center gap-1">
        <svg width="17" height="12" viewBox="0 0 17 12" fill="none">
          <rect x="0" y="6" width="3" height="6" rx="1" fill="#111" />
          <rect x="4.5" y="4" width="3" height="8" rx="1" fill="#111" />
          <rect x="9" y="2" width="3" height="10" rx="1" fill="#111" />
          <rect x="13.5" y="0" width="3" height="12" rx="1" fill="#111" />
        </svg>
        <svg width="25" height="12" viewBox="0 0 25 12" fill="none">
          <rect x="0.5" y="0.5" width="21" height="11" rx="3.5" stroke="#111" strokeOpacity=".35" />
          <rect x="2" y="2" width="16" height="8" rx="2" fill="#111" />
          <path d="M23 4v4a2 2 0 000-4z" fill="#111" fillOpacity=".4" />
        </svg>
      </div>
    </div>
  )
}
