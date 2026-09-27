import { useEffect, useState } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { brand } from '../../brand';
import { useLandingMotion } from './hooks';
import { faqItems } from './sampleData';

function Chevron() {
  return (
    <svg className="lp-faq__chevron" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Section 6. Button + aria-expanded disclosure. The panel's arrival moves
 * the questions below it with `layout` (FLIP: transforms, not animated
 * height) at `base`/settle; the answer itself fades up. Reduced motion:
 * instant open/close.
 *
 * Never gate content: the server render (and so the JS-off page) has every
 * answer open. Once hydrated they fold to the usual closed accordion — one
 * commit after load, far below the fold. */
export function Faq() {
  const items = faqItems(brand.name);
  const { hydrated, reduced, duration, ease } = useLandingMotion();
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set(items.map((_, i) => i)));

  useEffect(() => {
    if (hydrated) setOpen(new Set());
  }, [hydrated]);

  const toggle = (i: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const layoutTransition = reduced ? { duration: 0 } : { duration: duration.base, ease: ease.settle };

  return (
    <section className="lp-section lp-faq" id="faq" aria-labelledby="lp-faq-title">
      <div className="lp-wrap lp-faq__grid">
        <h2 className="lp-h2" id="lp-faq-title">
          Questions
        </h2>
        <LayoutGroup>
          <ul className="lp-faq__list">
            {items.map((item, i) => {
              const isOpen = open.has(i);
              const panelId = `lp-faq-panel-${i}`;
              const buttonId = `lp-faq-button-${i}`;
              return (
                <motion.li key={item.q} layout="position" transition={layoutTransition} className="lp-faq__item">
                  <h3 className="lp-faq__q">
                    <button
                      type="button"
                      id={buttonId}
                      className="lp-faq__button lp-press"
                      aria-expanded={isOpen}
                      aria-controls={panelId}
                      onClick={() => toggle(i)}
                    >
                      <span>{item.q}</span>
                      <Chevron />
                    </button>
                  </h3>
                  <AnimatePresence initial={false} mode="popLayout">
                    {isOpen && (
                      <motion.div
                        key="panel"
                        id={panelId}
                        role="region"
                        aria-labelledby={buttonId}
                        className="lp-faq__panel"
                        initial={reduced ? false : { opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: -6 }}
                        transition={layoutTransition}
                      >
                        <p>{item.a}</p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.li>
              );
            })}
          </ul>
        </LayoutGroup>
      </div>
    </section>
  );
}

export default Faq;
