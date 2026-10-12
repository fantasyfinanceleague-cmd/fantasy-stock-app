import { useRef, type ReactNode } from 'react';
import { motion, useScroll, useTransform, type MotionValue } from 'motion/react';
import { useEnhanced } from './hooks';

// Kinetic type (round 4; Design Lead condition 7). A split heading keeps
// its full verbatim text for assistive tech (visually hidden) and renders
// the split letters/words aria-hidden — screen readers never spell a
// headline letter by letter. Spaces stay real text between word spans, so
// word-spacing still applies. Server render, JS off and reduced motion show
// the heading fully assembled.

/** One word's letters, each its own span (for the per-letter rise). */
function Letters({ word, from }: { word: string; from: number }) {
  return (
    <span className="lp-word">
      {[...word].map((ch, i) => (
        <span key={i} className="lp-char" style={{ ['--lp-c' as string]: from + i }}>
          {ch}
        </span>
      ))}
    </span>
  );
}

/** A line split into letters; `--lp-c` counts letters across the line. */
export function SplitLetters({ text }: { text: string }) {
  const words = text.split(' ');
  let n = 0;
  return (
    <>
      {words.map((w, i) => {
        const from = n;
        n += w.length;
        return (
          <span key={i}>
            {i > 0 ? ' ' : null}
            <Letters word={w} from={from} />
          </span>
        );
      })}
    </>
  );
}

/** Word-by-word scroll scrub for a section heading: each word rises out of
 * depth (translate + a little rotateX, never opacity — the text is always
 * at full contrast) as the heading enters, staggered in reading order, and
 * is fully set by the time it reaches the reading zone. */
function ScrubWord({ children, progress, i, total }: { children: ReactNode; progress: MotionValue<number>; i: number; total: number }) {
  const start = (i / total) * 0.45;
  const k = useTransform(progress, (p) => {
    const e = Math.min(1, Math.max(0, (p - start) / 0.55));
    return 1 - (1 - e) ** 3;
  });
  const y = useTransform(k, (e) => `${((1 - e) * 0.55).toFixed(3)}em`);
  const rotateX = useTransform(k, (e) => (1 - e) * -55);
  return (
    <motion.span className="lp-kword" style={{ y, rotateX }}>
      {children}
    </motion.span>
  );
}

export function KineticHeading({
  id,
  className,
  lines,
}: {
  id: string;
  className: string;
  /** Lines of { text, em? } parts; the em part renders in <em>. */
  lines: ReadonlyArray<ReadonlyArray<{ text: string; em?: boolean }>>;
}) {
  const enhanced = useEnhanced();
  const ref = useRef<HTMLHeadingElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'start 0.6'] });
  const full = lines.map((l) => l.map((p) => p.text).join('')).join(' ');
  const words = lines.flatMap((l, li) =>
    l.flatMap((p) =>
      p.text
        .split(' ')
        .filter(Boolean)
        .map((w) => ({ w, em: p.em === true, li }))
    )
  );
  let wi = 0;
  return (
    <h2 ref={ref} id={id} className={className}>
      <span className="lp-sr">{full}</span>
      <span aria-hidden="true" className={enhanced ? 'lp-kinetic lp-kinetic--live' : 'lp-kinetic'}>
        {lines.map((_, li) => (
          <span key={li} className="lp-kinetic__line">
            {words
              .filter((x) => x.li === li)
              .map((x, j) => {
                const i = wi++;
                const word = x.em ? <em>{x.w}</em> : x.w;
                return (
                  <span key={j}>
                    {j > 0 ? ' ' : null}
                    {enhanced ? (
                      <ScrubWord progress={scrollYProgress} i={i} total={words.length}>
                        {word}
                      </ScrubWord>
                    ) : (
                      <span className="lp-kword">{word}</span>
                    )}
                  </span>
                );
              })}
          </span>
        ))}
      </span>
    </h2>
  );
}
