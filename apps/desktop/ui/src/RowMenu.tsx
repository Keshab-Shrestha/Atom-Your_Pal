import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { Icon } from "./icons.tsx";

export interface MenuItem {
  label: string;
  onSelect: () => void;
  /** Why it cannot be used now. The item stays, so nobody has to guess where it went. */
  disabledWhy?: string;
  danger?: boolean;
  /** A choice among several: shown with a check when true, and announced as a radio item. */
  checked?: boolean;
}

/** A small actions menu: opens on its button, moves with the arrow keys, closes on Escape, Tab or a click elsewhere. */
export function RowMenu({
  label,
  items,
  variant = "row",
  children,
  footer,
  up,
  disabledWhy,
}: {
  label: string;
  items: MenuItem[];
  variant?: "row" | "inline";
  children?: ComponentChildren;
  /** Explanatory text under the items. */
  footer?: ComponentChildren;
  /** Open upward (for a button at the bottom of the window). */
  up?: boolean;
  /** The whole menu cannot be used now: the button stays, says why, and does not open. */
  disabledWhy?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>('[role^="menuitem"]')?.focus();
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const buttons = () => [...(root.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]') ?? [])];
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
        aria-disabled={disabledWhy ? "true" : undefined}
        title={disabledWhy}
        onClick={() => !disabledWhy && setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open && !disabledWhy) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {children ?? <Icon name="more" size={16} />}
      </button>
      {open ? (
        <ul
          class={up ? "menu menu-up" : "menu"}
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
                role={item.checked === undefined ? "menuitem" : "menuitemradio"}
                aria-checked={item.checked === undefined ? undefined : item.checked}
                class={item.danger ? "menu-item danger" : "menu-item"}
                aria-disabled={item.disabledWhy ? "true" : undefined}
                title={item.disabledWhy}
                onClick={() => {
                  if (item.disabledWhy) return;
                  close(false);
                  item.onSelect();
                }}
              >
                {item.checked === undefined ? null : <span class="menu-check" aria-hidden="true">{item.checked ? <Icon name="check" size={14} /> : null}</span>}
                {item.label}
              </button>
            </li>
          ))}
          {footer ? <li role="none" class="menu-note">{footer}</li> : null}
        </ul>
      ) : null}
    </div>
  );
}
