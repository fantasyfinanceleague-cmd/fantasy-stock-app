/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { ReactNode, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Redirect } from 'expo-router';

import { color, radius, space } from '@/constants/tokens';
import { Surface } from '@/components/sp/Surface';
import { Text } from '@/components/sp/Text';
import { Money } from '@/components/sp/Money';
import { Button } from '@/components/sp/Button';
import { Chip } from '@/components/sp/Chip';
import { PhaseChip, LeaguePhase } from '@/components/sp/PhaseChip';
import { ListRow } from '@/components/sp/ListRow';
import { SegmentedControl } from '@/components/sp/SegmentedControl';
import { Sheet } from '@/components/sp/Sheet';
import { Avatar } from '@/components/sp/Avatar';
import { EmptyState } from '@/components/sp/EmptyState';
import { BrandMark } from '@/components/sp/BrandMark';
import { LiveDot } from '@/components/sp/game/LiveDot';
import { Scoreboard } from '@/components/sp/game/Scoreboard';
import { useMotion } from '@/components/sp/motion';

// Stockpile — dev-only design gallery (Phase 2 foundation). SOURCE OF TRUTH:
// the Phase 2 brief, build item 7: "renders every primitive in every state
// on both surfaces, plus a live Scoreboard demo with a button that triggers
// a lead change. This is your proof and the living spec." Redirects home
// outside __DEV__ so it never ships as a reachable screen in a release build.

const ALL_PHASES: LeaguePhase[] = [
  'pre_draft',
  'drafting',
  'pre_season',
  'live_open',
  'live_closed',
  'week_final',
  'playoffs',
  'season_complete',
];

export default function DesignGalleryScreen() {
  // Hooks run unconditionally, ABOVE the __DEV__ early return below — RN's
  // eslint-plugin-react-hooks rules-of-hooks (error-level in this repo) has
  // no special case for a compile-time-constant guard, so the guard has to
  // come after every hook call, not before.
  const { reduced } = useMotion();
  const [segment, setSegment] = useState('all');
  const [sheetVisible, setSheetVisible] = useState(false);
  const [chipSelected, setChipSelected] = useState(false);
  const [scores, setScores] = useState({ you: 128.4, opponent: 92.1 });
  const [chyron, setChyron] = useState<string | null>(null);

  if (!__DEV__) {
    return <Redirect href="/" />;
  }

  function triggerLeadChange() {
    setScores((prev) => {
      // Flip who's ahead so <TugBar>/<ScoreDigits> exercise the lead-change
      // overshoot (`spring.lively`) rather than just ticking in place.
      const wasYouAhead = prev.you >= prev.opponent;
      const next = wasYouAhead ? { you: prev.you - 40, opponent: prev.opponent + 260 } : { you: prev.you + 260, opponent: prev.opponent - 40 };
      return next;
    });
    setChyron('NVDA just put you ahead');
  }

  return (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <Section title="Reduce Motion">
        <Text variant="body">{`useMotion().reduced = ${reduced ? 'true' : 'false'}`}</Text>
      </Section>

      <Section title="Brand">
        <View style={styles.row}>
          <BrandMark size={32} tone="onLight" />
          <Text variant="title">Stockpile</Text>
        </View>
      </Section>

      <Section title="Type — money surface">
        <Surface kind="money" style={styles.moneySurface}>
          <Text variant="score.xl">$1,234</Text>
          <Text variant="score.lg">$1,234</Text>
          <Text variant="score.md">$1,234</Text>
          <Text variant="display">Portfolio</Text>
          <Text variant="title">Screen title</Text>
          <Text variant="headline">Section head</Text>
          <Text variant="body">Running text at body size.</Text>
          <Text variant="callout" tone="secondary">
            Secondary callout line
          </Text>
          <Text variant="caption" tone="secondary">
            Smallest informational caption
          </Text>
          <Text variant="body" tone="disabled">
            Disabled text
          </Text>
        </Surface>
      </Section>

      <Section title="Type — game surface">
        <Surface kind="game" style={styles.gameSurface}>
          <Text variant="tag">LIVE · WEEK 3</Text>
          <Text variant="score.xl">$1,234</Text>
          <Text variant="headline">On-game headline</Text>
          <Text variant="callout" tone="secondary">
            On-game secondary
          </Text>
        </Surface>
      </Section>

      <Section title="Money — sign & compact">
        <Surface kind="money" style={styles.moneySurface}>
          <Money value={56.8} sign="always" />
          <Money value={-3000} sign="always" />
          <Money value={0} sign="always" />
          <Money value={1234567.891} compact />
          <Money value={-0.004} sign="always" />
          <Money value={128.4} colorBySign />
          <Money value={-92.1} colorBySign />
          <Money value={0} colorBySign />
        </Surface>
      </Section>

      <Section title="Buttons — money surface">
        <Surface kind="money" style={styles.moneySurface}>
          <View style={styles.row}>
            <Button label="Primary" variant="primary" onPress={() => {}} />
            <Button label="Secondary" variant="secondary" onPress={() => {}} />
          </View>
          <View style={styles.row}>
            <Button label="Ghost" variant="ghost" onPress={() => {}} />
            <Button label="Destructive" variant="destructive" onPress={() => {}} />
          </View>
          <View style={styles.row}>
            <Button label="Small" variant="primary" size="sm" onPress={() => {}} />
            <Button label="Disabled" variant="primary" onPress={() => {}} disabled />
          </View>
        </Surface>
      </Section>

      <Section title="Buttons — game surface">
        <Surface kind="game" style={styles.gameSurface}>
          <View style={styles.row}>
            <Button label="Primary" variant="primary" onPress={() => {}} />
            <Button label="Secondary" variant="secondary" onPress={() => {}} />
            <Button label="Ghost" variant="ghost" onPress={() => {}} />
          </View>
        </Surface>
      </Section>

      <Section title="Chip & PhaseChip">
        <Surface kind="money" style={styles.moneySurface}>
          <View style={styles.row}>
            <Chip label="All leagues" selected={chipSelected} onPress={() => setChipSelected((v) => !v)} />
            <Chip label="Disabled" disabled />
          </View>
          <View style={[styles.row, styles.wrap]}>
            {ALL_PHASES.map((phase) => (
              <PhaseChip key={phase} phase={phase} />
            ))}
          </View>
        </Surface>
      </Section>

      <Section title="ListRow">
        <Surface kind="money" style={styles.moneySurface}>
          <ListRow title="Test League" subtitle="Rank 2 · 5-1" onPress={() => {}} trailing={<Avatar name="Priya" size={28} />} />
          <ListRow title="No chevron" subtitle="hideChevron" hideChevron trailing={<Text variant="callout">3rd</Text>} />
        </Surface>
      </Section>

      <Section title="SegmentedControl">
        <Surface kind="money" style={styles.moneySurface}>
          <SegmentedControl
            options={[
              { label: 'All matchups', value: 'all' },
              { label: 'Mine', value: 'mine' },
            ]}
            value={segment}
            onChange={setSegment}
          />
        </Surface>
      </Section>

      <Section title="Avatar">
        <View style={styles.row}>
          <Avatar name="Priya" size={44} />
          <Avatar name="Giorgio" size={32} />
          <Avatar name="?" size={24} />
        </View>
      </Section>

      <Section title="LiveDot">
        <Surface kind="game" style={styles.gameSurface}>
          <View style={styles.row}>
            <LiveDot />
            <Text variant="tag">LIVE</Text>
          </View>
        </Surface>
      </Section>

      <Section title="EmptyState">
        <Surface kind="money" style={styles.moneySurface}>
          <EmptyState
            icon="trophy-outline"
            title="No leagues yet"
            message="Create or join a league to get started."
            actionLabel="Create a league"
            onAction={() => {}}
          />
        </Surface>
      </Section>

      <Section title="Sheet">
        <Button label="Open sheet" variant="secondary" onPress={() => setSheetVisible(true)} />
        <Sheet visible={sheetVisible} onClose={() => setSheetVisible(false)}>
          <View style={styles.sheetContent}>
            <Text variant="title">Sheet content</Text>
            <Text variant="body" tone="secondary">
              Drag down or tap the backdrop to dismiss.
            </Text>
          </View>
        </Sheet>
      </Section>

      <Section title="Live Scoreboard demo">
        <Scoreboard
          leagueName="Test League"
          week={3}
          you={{ name: 'You', gain: scores.you }}
          opponent={{ name: 'Priya', gain: scores.opponent }}
          live
          chyronMessage={chyron}
          onChyronDismiss={() => setChyron(null)}
        />
        <View style={styles.leadChangeButton}>
          <Button label="Trigger lead change" variant="primary" onPress={triggerLeadChange} />
        </View>
      </Section>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text variant="callout" tone="secondary" style={styles.sectionTitle}>
        {title.toUpperCase()}
      </Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    padding: space[6],
    gap: space[8],
    backgroundColor: color.bg.app,
  },
  section: {
    gap: space[3],
  },
  sectionTitle: {
    letterSpacing: 0.5,
  },
  sectionBody: {
    gap: space[4],
  },
  moneySurface: {
    padding: space[5],
    borderRadius: radius.lg,
    gap: space[3],
  },
  gameSurface: {
    padding: space[5],
    borderRadius: radius.lg,
    gap: space[3],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
  },
  wrap: {
    flexWrap: 'wrap',
  },
  sheetContent: {
    padding: space[6],
    gap: space[3],
  },
  leadChangeButton: {
    marginTop: space[4],
    alignItems: 'flex-start',
  },
});
