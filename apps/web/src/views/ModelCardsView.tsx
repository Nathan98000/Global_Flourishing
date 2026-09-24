// Model cards (Phase 6): docs/model-cards/*.md are the source — rendered,
// not paraphrased — one per model family behind the Correlates view's
// adjusted toggle. The figure links here with the family as the hash.
// Like Methods, this route (marked included) is a lazy chunk.

import { marked } from 'marked'
import { useMemo } from 'react'
import binarySource from '../../../../docs/model-cards/binary.md?raw'
import continuousSource from '../../../../docs/model-cards/continuous.md?raw'
import styles from './MethodsView.module.css'

/** The cards, keyed by the `model` value /v1/correlates reports. */
const CARDS: readonly { id: string; source: string }[] = [
  { id: 'continuous', source: continuousSource },
  { id: 'binary', source: binarySource },
]

export function ModelCardsView() {
  const html = useMemo(
    () => CARDS.map((card) => ({ id: card.id, html: marked.parse(card.source, { async: false }) })),
    [],
  )
  return (
    <section className={styles.methods}>
      <h2>Model cards</h2>
      <div className={styles.summary}>
        <p>
          What the adjusted associations on the Correlates view are, exactly: one card per model
          family, stating the specification, the fixed control set, the weight, the standard error,
          what the coefficient means in words, and what it cannot tell you.
        </p>
      </div>
      {html.map((card) => (
        // Our own docs/model-cards/*.md, parsed at build time — not user input.
        <div
          key={card.id}
          id={card.id}
          className={styles.prose}
          dangerouslySetInnerHTML={{ __html: card.html }}
        />
      ))}
    </section>
  )
}
