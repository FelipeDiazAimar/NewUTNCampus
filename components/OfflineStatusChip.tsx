"use client";

import { useEffect, useState } from "react";

export default function OfflineStatusChip() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    setOffline(typeof navigator !== "undefined" && navigator.onLine === false);
    const goOffline = () => setOffline(true);
    const goOnline = () => setOffline(false);
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  if (!offline) return null;

  return (
    <span className="flex items-center gap-1.5 rounded-full bg-[rgba(52,199,89,0.14)] px-2.5 py-1 text-[12px] font-semibold text-[#248a3d] dark:text-[#34c759]">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#34c759] opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-[#34c759]" />
      </span>
      Modo Offline
    </span>
  );
}
