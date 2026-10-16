# W8: the one dot rule, "You're in" (X07), on `chore/w8-tap-through`

**Screenshots stay out of the repo (Giorgio, 2026-10-14).** The four stills are in
**`~/fantasy-stock-design-review/chore-w8-tap-through/`**; this file is the index.

**Ruling (Design Lead, 2026-10-15): ONE rule app-wide, keepDots. A "·" may END a line and NEVER starts one.**
W4's `12599265` had put the opposite rule on this one sentence (a no-break space AFTER the dot, so the dot started the
next line: "Sat, Oct 10 / · 7:00 PM ET"). It is reverted: `dotStartsLine` is deleted, and the sentence's date phrase now
goes through `keepDots` (`keepDotsIn(body, when)`). The Stakes row and the five existing keepDots screens are untouched.

Why the phrase, not the whole sentence: `keepDots` glues any segment of 24 characters or fewer, and the sentence's first
segment ("The draft is Sat, Oct 10") is exactly 24, so whole-sentence `keepDots` would make it one unbreakable run at
XXXL and leave "7:00 PM ET" free to split. Gluing only "Sat, Oct 10 · 7:00 PM ET" keeps "The draft is" free to wrap
before it, which is the break the ruling expects.

## Build and device

Built from `origin/main` 59e1222b plus this branch's working tree (the dot-rule change is in
`apps/mobile/lib/game/keepDots.ts`, `lib/join/joinPreview.ts`, `app/join-league.tsx`). iPhone 17e simulator, iOS 27.0,
Expo Go, status bar pinned at 9:41, the `JOIN_FIXTURE=preview` + `JOIN_AUTO=join` fixture (a dead Supabase URL; nothing
joined). Each still: appearance and text size set with `simctl ui`, a COLD launch, then polled until two consecutive
frames matched (the pop animation settles). Driver: `x07.sh` in the review folder. Four distinct frames, none blank.

## States

| File | State | Break measured |
|---|---|---|
| `X07-youre-in-17e-l-light.png` | Large, Light | "The draft is Sat, Oct 10 · 7:00 PM ET. The draft order / is set an hour before." (two lines; the dot mid-line) |
| `X07-youre-in-17e-l-dark.png` | Large, Dark | same |
| `X07-youre-in-17e-xxxl-light.png` | XXXL, Light | "The draft is Sat, Oct 10 ·" / "7:00 PM ET. The draft" / "order is set an hour" / "before." |
| `X07-youre-in-17e-xxxl-dark.png` | XXXL, Dark | same |

**The expected XXXL break is "Sat, Oct 10 · / 7:00 PM ET": it is exactly that.** The dot ends its line in both themes;
no line starts with "·". (The Stakes row, left alone, breaks "Equal stakes · / $2,000 per slot" the same way.)

## Pins (Deno)

`tests-deno/dot-rule.test.ts` simulates the line breaker over the DISPLAYED sentence (the only break opportunities are
plain spaces; a no-break space never breaks) at every width from 8 to 60 characters and fails if any wrapped line starts
with "·", for three real dates. It also asserts `dotStartsLine` is gone from the whole source, and that the screen routes
the sentence through `keepDotsIn`.

Mutations (restored): `keepDots` with the no-break space AFTER the dot (W4's rule) turned 4 of 8 tests red; the screen
un-routed (`{v.body}`) turned 1 red.

## §4 Every tappable element

| Element | Where | Does | Evidence |
|---|---|---|---|
| Go to the league | You're in | the league's Home | tapped in the W8 tap-through (`tap-through-2026-10.md`, "You're in") |
