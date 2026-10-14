import { motion } from "motion/react";

export interface KineticWord {
  text: string;
  tone?: "muted" | "accent";
}

const container = { hidden: {}, show: { transition: { staggerChildren: 0.026 } } };
const letter = {
  hidden: { y: "108%", opacity: 0, filter: "blur(6px)" },
  show: { y: "0%", opacity: 1, filter: "blur(0px)", transition: { duration: 0.75, ease: [0.16, 1, 0.3, 1] as const } },
};

// Each line rises letter by letter from behind a mask, one line after the other.
export function KineticHeadline({ lines }: { lines: KineticWord[][] }) {
  return (
    <h1 className="kinetic">
      {lines.map((words, li) => (
        <motion.span
          key={words.map(w => w.text).join(" ")}
          className="kinetic-line"
          variants={container}
          initial="hidden"
          animate="show"
          transition={{ delayChildren: 0.15 + li * 0.35 }}
        >
          {words.map((word, wi) => (
            <span className={`kinetic-word ${word.tone ? `tone-${word.tone}` : ""}`} key={`${word.text}-${wi}`}>
              <span className="sr-only">{word.text}</span>
              <span aria-hidden="true" className="kinetic-chars">
                {word.text.split("").map((ch, ci) => (
                  <span className="kinetic-mask" key={ci}>
                    <motion.span className="kinetic-letter" variants={letter}>
                      {ch}
                    </motion.span>
                  </span>
                ))}
              </span>
            </span>
          ))}
        </motion.span>
      ))}
    </h1>
  );
}
