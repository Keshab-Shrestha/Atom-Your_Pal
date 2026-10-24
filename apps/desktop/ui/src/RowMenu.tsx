import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { Icon } from "./icons.tsx";

export interface MenuItem {
  label: string;
  onSelect: () => void;
  /** Why it cannot be used now. The item stays, so nobody has to guess where it went. */
  disabledWhy?: string;
  danger?: boolean;
}

/** A small actions menu: opens on its button, moves with the arrow keys, closes on Escape, Tab or a click elsewhere. */
export function RowMenu({ label, items, variant = "row", children }: { label: string; items: MenuItem[]; variant?: "row" | "inline"; children?: ComponentChildren }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const buttons = () => [...(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };

  return (
    <div class={variant === "row" ? "rowmenu" : "inlinemenu"} ref={root}>
      <button
        type="button"
        ref={trigger}
        class={variant === "row" ? "row-more" : "inline-more"}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {children ?? <Icon name="more" size={16} />}
      </button>
      {open ? (
        <ul
          class="menu"
          role="menu"
          aria-label={label}
          onKeyDown={(e) => {
            const all = buttons();
            const at = all.indexOf(document.activeElement as HTMLButtonElement);
            if (e.key === "ArrowDown") (e.preventDefault(), all[(at + 1) % all.length]?.focus());
            else if (e.key === "ArrowUp") (e.preventDefault(), all[(at - 1 + all.length) % all.length]?.focus());
            else if (e.key === "Home") (e.preventDefault(), all[0]?.focus());
            else if (e.key === "End") (e.preventDefault(), all.at(-1)?.focus());
            else if (e.key === "Escape") (e.preventDefault(), e.stopPropagation(), close(true));
            else if (e.key === "Tab") close(false);
          }}
        >
          {items.map((item) => (
            <li key={item.label} role="none">
              <button
                type="button"
                role="menuitem"
                class={item.danger ? "menu-item danger" : "menu-item"}
                aria-disabled={item.disabledWhy ? "true" : undefined}
                title={item.disabledWhy}
                onClick={() => {
                  if (item.disabledWhy) return;
                  close(false);
                  item.onSelect();
                }}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
