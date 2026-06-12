"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";

export default function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Avoid hydration mismatch: only render the icon after mount
  useEffect(() => setMounted(true), []);

  if (!mounted) return <div className="w-8 h-8" aria-hidden />;

  const isDark = resolvedTheme === "dark";

  function toggleTheme() {
    // Activa la transición solo durante el cambio de tema, no en scroll.
    // Sin esto, `transition: background-color` en body dispara recálculos
    // en cada frame de scroll en Android Chrome.
    document.documentElement.classList.add("theme-transitioning");
    setTheme(isDark ? "light" : "dark");
    setTimeout(() => document.documentElement.classList.remove("theme-transitioning"), 400);
  }

  return (
    <button
      onClick={toggleTheme}
      title={isDark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
      className="flex items-center justify-center w-8 h-8 rounded-lg
        text-[#6c6c70] dark:text-[#8e8e93]
        hover:bg-black/5 dark:hover:bg-white/10
        transition-colors duration-200"
    >
      {isDark ? <Sun size={17} strokeWidth={2} /> : <Moon size={17} strokeWidth={2} />}
    </button>
  );
}
