import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import { Icon } from "./Icon.tsx";

export interface LightboxItem {
  key: string;
  src: string;
  caption: string;
}

interface Props {
  items: LightboxItem[];
  index: number | null;
  onChange: (index: number | null) => void;
}

export function Lightbox({ items, index, onChange }: Props) {
  const item = index === null ? undefined : items[index];

  useEffect(() => {
    if (index === null) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onChange(null);
      if (e.key === "ArrowRight") onChange(Math.min(items.length - 1, index + 1));
      if (e.key === "ArrowLeft") onChange(Math.max(0, index - 1));
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [index, items.length, onChange]);

  return (
    <AnimatePresence>
      {item && index !== null ? (
        <motion.div className="lightbox" role="dialog" aria-modal="true" aria-label={item.caption} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} onClick={() => onChange(null)}>
          <motion.figure className="lightbox-figure" onClick={e => e.stopPropagation()}>
            <motion.img layoutId={item.key} src={item.src} alt={item.caption} transition={{ type: "spring", stiffness: 280, damping: 32 }} />
            <figcaption>{item.caption}</figcaption>
          </motion.figure>
          <button type="button" className="lightbox-close btn btn-ghost" onClick={() => onChange(null)} aria-label="Close">
            <Icon name="x" size={18} />
          </button>
          {index > 0 ? (
            <button type="button" className="lightbox-nav is-prev btn btn-ghost" onClick={e => (e.stopPropagation(), onChange(index - 1))} aria-label="Previous screenshot">
              <Icon name="chevron" size={20} style={{ transform: "rotate(180deg)" }} />
            </button>
          ) : null}
          {index < items.length - 1 ? (
            <button type="button" className="lightbox-nav is-next btn btn-ghost" onClick={e => (e.stopPropagation(), onChange(index + 1))} aria-label="Next screenshot">
              <Icon name="chevron" size={20} />
            </button>
          ) : null}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
