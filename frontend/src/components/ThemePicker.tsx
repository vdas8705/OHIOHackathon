import { useEffect, useRef, useState } from "react";
import { Palette, UserCircle } from "lucide-react";
import type { Theme } from "../themes";
import { PersonAvatars, PersonAvatarSVG } from "./PersonAvatars";

interface Props {
  themeId: string;
  themes: Theme[];
  onSelect: (id: string) => void;
  userAvatarId: number;
  onAvatarSelect: (id: number) => void;
}

export function ThemePicker({ themeId, themes, onSelect, userAvatarId, onAvatarSelect }: Props) {
  const [open, setOpen] = useState(false);
  const [showAvatars, setShowAvatars] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onOutside(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onOutside);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onOutside);
    };
  }, [open]);

  const current = themes.find((t) => t.id === themeId) ?? themes[0];

  return (
    <div ref={containerRef} className="relative">
      <button
        aria-label={`Theme picker — current theme: ${current.label}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => { setOpen((o) => !o); setShowAvatars(false); }}
        className="flex h-8 w-8 items-center justify-center rounded-full border transition-all focus:outline-none focus:ring-2"
        style={{
          background: "var(--bg-panel)",
          borderColor: "var(--bg-panel-border)",
          color: "var(--text-secondary)",
        }}
        title="Change theme or avatar"
      >
        <Palette className="h-4 w-4" aria-hidden="true" />
      </button>

      {open && (
        <div
          className="absolute right-0 top-10 z-50 min-w-[220px] rounded-2xl border p-3 shadow-2xl"
          style={{
            background: "var(--bg-panel)",
            borderColor: "var(--bg-panel-border)",
          }}
        >
          {!showAvatars && (
            <>
              <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider"
                 style={{ color: "var(--text-secondary)" }}>
                Theme
              </p>
              <div role="listbox" aria-label="Select a theme">
                {themes.map((theme) => {
                  const active = theme.id === themeId;
                  return (
                    <button
                      key={theme.id}
                      role="option"
                      aria-selected={active}
                      onClick={() => { onSelect(theme.id); }}
                      className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-sm transition-all focus:outline-none focus:ring-2"
                      style={{
                        background: active ? "var(--badge-bg)" : "transparent",
                        color: active ? "var(--accent)" : "var(--text-primary)",
                      }}
                    >
                      {/* 3-color swatch: bg, bubble, accent */}
                      <span className="flex shrink-0 gap-0.5" aria-hidden="true">
                        <span className="h-4 w-3 rounded-l border" style={{ background: theme.swatch[0] }} />
                        <span className="h-4 w-3 border-x" style={{ background: theme.swatch[1] }} />
                        <span className="h-4 w-3 rounded-r border" style={{ background: theme.swatch[2] }} />
                      </span>
                      <span>{theme.label}</span>
                      {active && (
                        <span className="ml-auto text-xs font-bold" style={{ color: "var(--accent)" }}>✓</span>
                      )}
                    </button>
                  );
                })}
              </div>
              {/* Avatar picker link */}
              <button
                onClick={() => setShowAvatars(true)}
                className="mt-2 flex w-full items-center gap-2 rounded-xl px-2 py-2 text-sm transition-all hover:opacity-80"
                style={{ color: "var(--text-secondary)" }}
              >
                <UserCircle className="h-4 w-4" />
                Choose your avatar
              </button>
            </>
          )}

          {showAvatars && (
            <>
              <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider"
                 style={{ color: "var(--text-secondary)" }}>
                Your avatar
              </p>
              <div className="grid grid-cols-4 gap-2">
                {PersonAvatars.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => { onAvatarSelect(i); }}
                    aria-label={`Avatar ${i + 1}`}
                    aria-selected={userAvatarId === i}
                    className="rounded-xl p-1 transition-all focus:outline-none focus:ring-2"
                    style={{
                      background: userAvatarId === i ? "var(--badge-bg)" : "transparent",
                      boxShadow: userAvatarId === i ? "0 0 0 2px var(--accent)" : "none",
                    }}
                  >
                    <PersonAvatarSVG index={i} size={36} />
                  </button>
                ))}
              </div>
              <button
                onClick={() => setShowAvatars(false)}
                className="mt-2 w-full rounded-xl px-2 py-1.5 text-xs"
                style={{ color: "var(--text-secondary)" }}
              >
                ← Back to themes
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
