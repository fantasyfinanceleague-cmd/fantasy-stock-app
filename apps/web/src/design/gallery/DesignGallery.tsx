import { useState } from 'react';
import { MotionConfig } from 'motion/react';
import { brand } from '../index';
import { Surface } from '../Surface';
import { Text, type TextVariant } from '../Text';
import { Money } from '../Money';
import { Button, type ButtonVariant } from '../Button';
import { Chip } from '../Chip';
import { PhaseChip, type Phase } from '../PhaseChip';
import { SegmentedControl } from '../SegmentedControl';
import { Sheet } from '../Sheet';
import { EmptyState } from '../EmptyState';
import { Scoreboard } from '../game/Scoreboard';
import './DesignGallery.css';

// Dev-only (see App.jsx's `import.meta.env.DEV` gate) proof-and-living-spec
// for every Phase 2 primitive: DESIGN_DIRECTION.md §2 asks for "every
// primitive in every state on both surfaces, a live Scoreboard with a
// button that triggers a lead change, and both themes of focus rings."

const TEXT_VARIANTS: TextVariant[] = [
  'display',
  'title',
  'headline',
  'body',
  'callout',
  'caption',
  'tag',
  'score.md',
  'score.lg',
  'score.xl',
];

const BUTTON_VARIANTS: ButtonVariant[] = ['primary', 'secondary', 'ghost', 'destructive'];

const ALL_PHASES: Phase[] = [
  'pre_draft',
  'drafting',
  'pre_season',
  'live_open',
  'live_closed',
  'week_final',
  'playoffs',
  'season_complete',
];

// score.* variants are `nowrap` by default (real scores are short numbers,
// never a full sentence — DESIGN_DIRECTION §9 "scores never wrap"), so
// their demo text is a short realistic example, not the long pangram: a
// long nowrap string here would clip internally but still push the whole
// gallery page wider than the viewport at narrow widths.
const SCORE_VARIANT_SET = new Set<TextVariant>(['score.md', 'score.lg', 'score.xl']);

function TextSpecimens() {
  return (
    <>
      {TEXT_VARIANTS.map((variant) => (
        <div key={variant} style={{ marginBottom: 'var(--sp-space-3)' }}>
          <Text variant="caption" tone="secondary" as="span">
            {variant}
          </Text>{' '}
          <Text variant={variant} as="span">
            {SCORE_VARIANT_SET.has(variant) ? '+$56.80' : 'The quick brown fox'}
          </Text>
        </div>
      ))}
    </>
  );
}

function MoneySpecimens() {
  return (
    <div className="sp-gallery__row">
      <Money value={56.8} sign="always" />
      <Money value={-3000} sign="always" />
      <Money value={0} sign="always" />
      <Money value={1234567.891} compact />
      <Money value={-1234567.891} compact />
      <Money value={-56.8} colorBySign={false} />
    </div>
  );
}

function ButtonSpecimens() {
  return (
    <>
      <div className="sp-gallery__row">
        {BUTTON_VARIANTS.map((variant) => (
          <Button key={variant} variant={variant} size="md">
            {variant}
          </Button>
        ))}
      </div>
      <div className="sp-gallery__row">
        {BUTTON_VARIANTS.map((variant) => (
          <Button key={variant} variant={variant} size="sm">
            {variant} sm
          </Button>
        ))}
        <Button disabled>disabled</Button>
      </div>
    </>
  );
}

function ChipSpecimens() {
  return (
    <>
      <div className="sp-gallery__row">
        <Chip tone="neutral">Neutral chip</Chip>
        <Chip tone="brand">Brand chip</Chip>
      </div>
      <div className="sp-gallery__row">
        {ALL_PHASES.map((phase) => (
          <PhaseChip key={phase} phase={phase} />
        ))}
      </div>
    </>
  );
}

function SegmentedControlSpecimen() {
  const [value, setValue] = useState('1w');
  return (
    <SegmentedControl
      aria-label="Range"
      value={value}
      onChange={setValue}
      options={[
        { value: '1d', label: '1D' },
        { value: '1w', label: '1W' },
        { value: '1m', label: '1M' },
        { value: 'all', label: 'ALL' },
      ]}
    />
  );
}

function SheetSpecimen() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open sheet</Button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Example sheet">
        <Text variant="title" as="h2">
          Example sheet
        </Text>
        <Text variant="body" as="p">
          Tab cycles between the two buttons below; Escape or the backdrop closes it and returns focus to the
          trigger.
        </Text>
        <div className="sp-gallery__row">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={() => setOpen(false)}>Confirm</Button>
        </div>
      </Sheet>
    </>
  );
}

function EmptyStateSpecimen() {
  return (
    <EmptyState
      icon="🏆"
      title="No leagues yet"
      line="Create one, or join with a code from a friend."
      action={{ label: 'Create a league', onClick: () => {} }}
    />
  );
}

function ScoreboardSpecimen() {
  const [leading, setLeading] = useState<'you' | 'opponent'>('you');
  const [message, setMessage] = useState<string | null>(null);

  function triggerLeadChange() {
    const next = leading === 'you' ? 'opponent' : 'you';
    setLeading(next);
    setMessage(next === 'you' ? 'NVDA just put you ahead' : 'TSLA drags you behind');
  }

  const you = leading === 'you' ? 120.5 : 40;
  const opponent = leading === 'you' ? 40 : 120.5;

  return (
    <>
      <Scoreboard
        leagueName="The League"
        week={3}
        live
        you={{ name: 'You', gain: you }}
        opponent={{ name: 'Priya', gain: opponent }}
        chyronMessage={message}
        onChyronDismiss={() => setMessage(null)}
      />
      <div style={{ marginTop: 'var(--sp-space-4)' }}>
        <Button onClick={triggerLeadChange}>Trigger lead change</Button>
      </div>
    </>
  );
}

export function DesignGallery() {
  const [forceReducedMotion, setForceReducedMotion] = useState(false);

  return (
    <MotionConfig reducedMotion={forceReducedMotion ? 'always' : 'user'}>
      <div className="sp-gallery">
        <div className="sp-gallery__toolbar">
          <div className="sp-gallery__toolbar-brand">
            <brand.mark size={28} />
            <Text variant="title" as="span">
              Design gallery
            </Text>
          </div>
          <label className="sp-gallery__toggle">
            <input
              type="checkbox"
              checked={forceReducedMotion}
              onChange={(e) => setForceReducedMotion(e.target.checked)}
            />
            Force reduced motion
          </label>
        </div>

        <Surface kind="money" as="section" className="sp-gallery__section">
          <Text variant="title" as="h2" className="sp-gallery__section-title">
            Text — money surface
          </Text>
          <TextSpecimens />
        </Surface>

        <Surface kind="money" as="section" className="sp-gallery__section">
          <Text variant="title" as="h2" className="sp-gallery__section-title">
            Money — money surface
          </Text>
          <MoneySpecimens />
        </Surface>

        <Surface kind="money" as="section" className="sp-gallery__section">
          <Text variant="title" as="h2" className="sp-gallery__section-title">
            Button — money surface (Tab through to see the focus ring)
          </Text>
          <ButtonSpecimens />
        </Surface>

        <Surface kind="money" as="section" className="sp-gallery__section">
          <Text variant="title" as="h2" className="sp-gallery__section-title">
            Chip / PhaseChip — money surface
          </Text>
          <ChipSpecimens />
        </Surface>

        <Surface kind="money" as="section" className="sp-gallery__section">
          <Text variant="title" as="h2" className="sp-gallery__section-title">
            SegmentedControl — money surface
          </Text>
          <SegmentedControlSpecimen />
        </Surface>

        <Surface kind="money" as="section" className="sp-gallery__section">
          <Text variant="title" as="h2" className="sp-gallery__section-title">
            Sheet — money surface
          </Text>
          <SheetSpecimen />
        </Surface>

        <Surface kind="money" as="section" className="sp-gallery__section">
          <Text variant="title" as="h2" className="sp-gallery__section-title">
            EmptyState
          </Text>
          <EmptyStateSpecimen />
        </Surface>

        <Surface kind="game" as="section" className="sp-gallery__section sp-gallery__section--game">
          <Text variant="title" as="h2" className="sp-gallery__section-title">
            Text — game surface
          </Text>
          <TextSpecimens />
        </Surface>

        <Surface kind="game" as="section" className="sp-gallery__section sp-gallery__section--game">
          <Text variant="title" as="h2" className="sp-gallery__section-title">
            Money — game surface
          </Text>
          <MoneySpecimens />
        </Surface>

        <Surface kind="game" as="section" className="sp-gallery__section sp-gallery__section--game">
          <Text variant="title" as="h2" className="sp-gallery__section-title">
            Button — game surface (Tab through to see the focus ring)
          </Text>
          <ButtonSpecimens />
        </Surface>

        <Surface kind="game" as="section" className="sp-gallery__section sp-gallery__section--game">
          <Text variant="title" as="h2" className="sp-gallery__section-title">
            Chip / PhaseChip — game surface (live_open becomes the broadcast tag)
          </Text>
          <ChipSpecimens />
        </Surface>

        <Surface kind="game" as="section" className="sp-gallery__section sp-gallery__section--game">
          <Text variant="title" as="h2" className="sp-gallery__section-title">
            Scoreboard (live demo)
          </Text>
          <ScoreboardSpecimen />
        </Surface>
      </div>
    </MotionConfig>
  );
}

export default DesignGallery;
