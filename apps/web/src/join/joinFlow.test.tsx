import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import JoinFlow from './JoinFlow';
import { parsePreviewLeague, type PreviewLeague } from './previewData';
import { APP_STORE_URL } from './config';
import { WEB_COPY } from './joinCopy';
import { makeAuthMock } from './testing/mockAuth';

const m = vi.hoisted(() => {
  // vi.hoisted can't import: this mirrors testing/mockAuth.ts
  const f = () => vi.fn();
  return {
    onboardingClient: vi.fn(() => null), currentSession: f(), signInWithProvider: f(), signUpWithEmail: f(), signInWithEmail: f(), exchangeCode: f(),
    signOutLocal: f(), readOwnUsername: f(), checkUsernames: f(), setUsername: f(), previewWithSession: f(), joinWithSession: f(),
  } as ReturnType<typeof makeAuthMock>;
});
vi.mock('./onboardingAuth', () => m);

const CODE = 'ABCDE23456';
const league = (over: Record<string, unknown> = {}): PreviewLeague =>
  parsePreviewLeague({
    name: 'Stock Scudetto', league_type: 'duration', num_participants: 6, current_members: 5, stake_mode: 'fixed_notional', notional_per_slot: 2000,
    num_weeks: 14, draft_date: '2026-10-03T23:00:00Z', draft_status: 'not_started', ...over,
  })!;

const renderFlow = (props: Partial<React.ComponentProps<typeof JoinFlow>> = {}) =>
  render(<JoinFlow code={CODE} name="Stock Scudetto" inviter="roberto_b" {...props} />);

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.currentSession.mockResolvedValue(null);
  m.signOutLocal.mockResolvedValue(undefined);
  m.readOwnUsername.mockResolvedValue('roberto');
  m.checkUsernames.mockImplementation(async (c: string[]) => c.map((username, i) => ({ username, status: i === 1 ? 'available' : 'taken' })));
  m.setUsername.mockResolvedValue('ok');
  m.previewWithSession.mockResolvedValue({ kind: 'found', league: league(), block: null });
  m.joinWithSession.mockResolvedValue({ kind: 'joined', leagueId: 'L1', leagueName: 'Stock Scudetto' });
});
afterEach(() => cleanup());

describe('signed out: the three options', () => {
  it('headline, then Apple, Google, email in the board\'s order, and nothing else', async () => {
    renderFlow();
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('roberto_b invited you to Stock Scudetto');
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(3);
    expect(buttons[0]).toHaveAccessibleName(WEB_COPY.continueApple);
    expect(buttons[1]).toHaveAccessibleName(WEB_COPY.continueGoogle);
    expect(buttons[2]).toHaveAccessibleName(WEB_COPY.useEmail);
    expect(screen.queryAllByRole('link')).toHaveLength(0); // no App Store badge, no extra links before sign-in
    expect(screen.queryByText(/Managers|Stakes|Season/)).toBeNull(); // the facts come after joining
    expect(m.signOutLocal).not.toHaveBeenCalled(); // not a terminal screen
  });

  it('with no preview: the generic headline, the same options', async () => {
    renderFlow({ name: null, inviter: null });
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(/^You're invited to a league$/);
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });

  it('with no inviter: "You\'re invited to {league}"', async () => {
    renderFlow({ inviter: null });
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(/^You're invited to Stock Scudetto$/);
  });

  it.each([['apple', WEB_COPY.continueApple], ['google', WEB_COPY.continueGoogle]] as const)('%s: starts the redirect with this invite', async (provider, label) => {
    m.signInWithProvider.mockResolvedValue({ error: null });
    renderFlow();
    await screen.findByRole('button', { name: label });
    click(label);
    await waitFor(() => expect(m.signInWithProvider).toHaveBeenCalledWith(provider, CODE));
  });

  it('a provider failure shows our line, never the server\'s, and the options come back', async () => {
    m.signInWithProvider.mockResolvedValue({ error: { message: 'Unsupported provider: provider is not enabled' } });
    renderFlow();
    await screen.findByRole('button', { name: WEB_COPY.continueApple });
    click(WEB_COPY.continueApple);
    expect(await screen.findByRole('alert')).toHaveTextContent(WEB_COPY.generic);
    expect(screen.getByRole('button', { name: WEB_COPY.continueApple })).toBeEnabled();
  });
});

describe('email', () => {
  const openCreate = async (props: Partial<React.ComponentProps<typeof JoinFlow>> = {}) => {
    renderFlow(props);
    await screen.findByRole('button', { name: WEB_COPY.useEmail });
    click(WEB_COPY.useEmail);
  };

  it('create account: the password rules check live, and a weak password never reaches the server', async () => {
    await openCreate();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(WEB_COPY.createAccount);
    type(WEB_COPY.emailLabel, 'a@b.co');
    type(WEB_COPY.passwordLabel, 'abc');
    fireEvent.submit(screen.getByRole('button', { name: WEB_COPY.createAccount }).closest('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent(/^Your password needs: at least 8 characters, an uppercase letter \(a–z\)?/i);
    expect(m.signUpWithEmail).not.toHaveBeenCalled();
    const rules = screen.getAllByRole('listitem');
    expect(rules).toHaveLength(5);
    expect(rules.filter((li) => li.getAttribute('data-ok') === 'true')).toHaveLength(1); // 'abc' meets "a lowercase letter" only
  });

  it('create account: signUp gets the invite, then "Check your email" names the league', async () => {
    m.signUpWithEmail.mockResolvedValue({ error: null, needsConfirmation: true });
    await openCreate();
    type(WEB_COPY.emailLabel, ' a@b.co ');
    type(WEB_COPY.passwordLabel, 'Str0ng!pass');
    click(WEB_COPY.createAccount);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Check your email'));
    expect(m.signUpWithEmail).toHaveBeenCalledWith('a@b.co', 'Str0ng!pass', CODE);
    expect(screen.getByText('We sent a link to a@b.co. Tap it to finish joining Stock Scudetto.')).toBeInTheDocument();
  });

  it('check your email with no league name: the no-invite sentence', async () => {
    m.signUpWithEmail.mockResolvedValue({ error: null, needsConfirmation: true });
    await openCreate({ name: null, inviter: null });
    type(WEB_COPY.emailLabel, 'a@b.co');
    type(WEB_COPY.passwordLabel, 'Str0ng!pass');
    click(WEB_COPY.createAccount);
    expect(await screen.findByText('We sent a link to a@b.co. Tap it to finish creating your account.')).toBeInTheDocument();
  });

  it('"Send again" repeats signUp for the same address; "Back to sign in" returns to the form', async () => {
    m.signUpWithEmail.mockResolvedValue({ error: null, needsConfirmation: true });
    await openCreate();
    type(WEB_COPY.emailLabel, 'a@b.co');
    type(WEB_COPY.passwordLabel, 'Str0ng!pass');
    click(WEB_COPY.createAccount);
    await screen.findByText(/We sent a link to a@b.co/);
    click(WEB_COPY.resend);
    await waitFor(() => expect(m.signUpWithEmail).toHaveBeenCalledTimes(2));
    expect(m.signUpWithEmail).toHaveBeenLastCalledWith('a@b.co', 'Str0ng!pass', CODE);
    click(WEB_COPY.checkEmailBack);
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(WEB_COPY.signIn);
  });

  it('a too-soon "Send again" shows the app\'s rate-limit line', async () => {
    m.signUpWithEmail.mockResolvedValueOnce({ error: null, needsConfirmation: true });
    m.signUpWithEmail.mockResolvedValueOnce({ error: { message: '', code: 'over_email_send_rate_limit' }, needsConfirmation: false });
    await openCreate();
    type(WEB_COPY.emailLabel, 'a@b.co');
    type(WEB_COPY.passwordLabel, 'Str0ng!pass');
    click(WEB_COPY.createAccount);
    await screen.findByText(/We sent a link/);
    click(WEB_COPY.resend);
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts — please wait a minute and try again.');
  });

  it('a signup-gate refusal is the approved paused line', async () => {
    m.signUpWithEmail.mockResolvedValue({ error: { message: 'Signups are not open for new signups' }, needsConfirmation: false });
    await openCreate();
    type(WEB_COPY.emailLabel, 'a@b.co');
    type(WEB_COPY.passwordLabel, 'Str0ng!pass');
    click(WEB_COPY.createAccount);
    expect(await screen.findByRole('alert')).toHaveTextContent(WEB_COPY.signupsPaused);
  });

  it('sign in: an unconfirmed account gets the app\'s line and "Send again"; forgot is PLAIN TEXT', async () => {
    m.signInWithEmail.mockResolvedValue({ error: { message: '', code: 'email_not_confirmed' } });
    m.signUpWithEmail.mockResolvedValue({ error: null, needsConfirmation: true });
    await openCreate();
    click(`${WEB_COPY.haveAccount} ${WEB_COPY.signIn}`);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(WEB_COPY.signIn);
    const forgot = screen.getByText(WEB_COPY.forgotInApp);
    expect(forgot.tagName).toBe('P');
    expect(within(forgot).queryAllByRole('link')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /forgot/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /forgot|reset/i })).toBeNull();
    type(WEB_COPY.emailLabel, 'a@b.co');
    type(WEB_COPY.passwordLabel, 'Str0ng!pass');
    fireEvent.submit(screen.getByLabelText(WEB_COPY.emailLabel).closest('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent('Please verify your email before signing in.');
    click(WEB_COPY.resend);
    await waitFor(() => expect(m.signUpWithEmail).toHaveBeenCalledWith('a@b.co', 'Str0ng!pass', CODE));
  });

  it('there is no forgot line on Create account', async () => {
    await openCreate();
    expect(screen.queryByText(WEB_COPY.forgotInApp)).toBeNull();
  });

  it('a wrong password: the app\'s line, no raw text', async () => {
    m.signInWithEmail.mockResolvedValue({ error: { message: 'Invalid login credentials', code: 'invalid_credentials' } });
    await openCreate();
    click(new RegExp(WEB_COPY.signIn));
    type(WEB_COPY.emailLabel, 'a@b.co');
    type(WEB_COPY.passwordLabel, 'x');
    fireEvent.submit(screen.getByLabelText(WEB_COPY.emailLabel).closest('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password. Please try again.');
  });

  it('a successful sign-in continues to the join', async () => {
    m.signInWithEmail.mockResolvedValue({ error: null });
    m.currentSession.mockResolvedValueOnce(null).mockResolvedValue({ userId: 'u1' });
    await openCreate();
    click(new RegExp(WEB_COPY.signIn));
    type(WEB_COPY.emailLabel, 'a@b.co');
    type(WEB_COPY.passwordLabel, 'Str0ng!pass');
    fireEvent.submit(screen.getByLabelText(WEB_COPY.emailLabel).closest('form')!);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent("You're in Stock Scudetto."));
  });
});

describe('after sign-in: username, join, terminal screens', () => {
  beforeEach(() => m.currentSession.mockResolvedValue({ userId: 'u1' }));
  /** Arrives the way the web callback leaves things: this visit produced the sign-in. */
  const renderAuthed = (props: Partial<React.ComponentProps<typeof JoinFlow>> = {}) =>
    renderFlow({ handoff: { signedIn: true }, ...props });

  it('has a username: previews, joins, then "You\'re in {league}." + "Get the app…" + the facts + the App Store, and ends the session', async () => {
    m.previewWithSession.mockResolvedValueOnce({ kind: 'found', league: league(), block: null });
    m.previewWithSession.mockResolvedValueOnce({ kind: 'found', league: league({ current_members: 6 }), block: 'already_member' });
    renderAuthed();
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent("You're in Stock Scudetto.");
    expect(screen.getByText('Get the app to draft and play.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: WEB_COPY.appStoreBadge })).toHaveAttribute('href', APP_STORE_URL);
    // C1: the facts are fetched AFTER the join, so Managers counts this person (6 of 6, not the preview's 5 of 6)
    expect(m.previewWithSession).toHaveBeenCalledTimes(2);
    const rows = screen.getAllByText(/^(Managers|Draft|Stakes|Season)$/).map((e) => e.textContent);
    expect(rows).toEqual(['Managers', 'Draft', 'Stakes', 'Season']);
    expect(screen.getByText('6 of 6')).toBeInTheDocument();
    expect(screen.getByText('Sat, Oct 3 · 7:00 PM ET')).toBeInTheDocument();
    expect(screen.getByText('Equal stakes · $2,000 per slot')).toBeInTheDocument();
    expect(screen.getByText('14 weeks')).toBeInTheDocument();
    expect(m.joinWithSession).toHaveBeenCalledWith(CODE);
    await waitFor(() => expect(m.signOutLocal).toHaveBeenCalled());
  });

  it('a failed facts fetch is not a failed join: "You\'re in" without the card', async () => {
    m.previewWithSession.mockResolvedValueOnce({ kind: 'found', league: league(), block: null });
    m.previewWithSession.mockResolvedValueOnce({ kind: 'error', error: 'unreachable' });
    renderAuthed();
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent("You're in Stock Scudetto.");
    expect(screen.queryByText('Managers')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('link', { name: WEB_COPY.appStoreBadge })).toBeInTheDocument();
  });

  it('a failed profile read fails OPEN (straight to the join), like the app', async () => {
    m.readOwnUsername.mockResolvedValue(undefined);
    renderAuthed();
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent("You're in Stock Scudetto.");
  });

  describe('no username yet', () => {
    beforeEach(() => m.readOwnUsername.mockResolvedValue(null));

    it('shows a pre-filled gamertag, the helper line, Keep and Change', async () => {
      renderAuthed({ handoff: { emailConfirmed: true, signedIn: true } });
      expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Pick a username');
      const field = screen.getByLabelText(WEB_COPY.usernameLabel) as HTMLInputElement;
      expect(field.value).toMatch(/^[A-Z][a-z]+[A-Z][a-z]+\d{3}$/);
      expect(field).toHaveAttribute('readonly');
      expect(screen.getByText(WEB_COPY.usernameHelper)).toBeInTheDocument();
      expect(screen.getByText('✓ EMAIL CONFIRMED')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: WEB_COPY.keep })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: WEB_COPY.notYouSignOut })).toBeInTheDocument();
      expect(m.joinWithSession).not.toHaveBeenCalled();
    });

    it('no chip unless the confirmation link brought them back', async () => {
      renderAuthed();
      await screen.findByLabelText(WEB_COPY.usernameLabel);
      expect(screen.queryByText('✓ EMAIL CONFIRMED')).toBeNull();
    });

    it('offers the available candidate', async () => {
      renderAuthed();
      const field = (await screen.findByLabelText(WEB_COPY.usernameLabel)) as HTMLInputElement;
      const candidates = m.checkUsernames.mock.calls[0][0] as string[];
      expect(candidates).toHaveLength(3);
      expect(field.value).toBe(candidates[1]);
    });

    it('Keep sets the name, then joins', async () => {
      renderAuthed();
      const field = (await screen.findByLabelText(WEB_COPY.usernameLabel)) as HTMLInputElement;
      m.checkUsernames.mockResolvedValueOnce([{ username: field.value, status: 'available' }]);
      click(WEB_COPY.keep);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent("You're in Stock Scudetto."));
      expect(m.setUsername).toHaveBeenCalledWith(field.value);
    });

    it('Change opens the field; a bad format never reaches the server', async () => {
      renderAuthed();
      await screen.findByLabelText(WEB_COPY.usernameLabel);
      click(WEB_COPY.change);
      const field = screen.getByLabelText(WEB_COPY.usernameLabel);
      expect(field).not.toHaveAttribute('readonly');
      fireEvent.change(field, { target: { value: 'ab' } });
      click(WEB_COPY.keep);
      expect(await screen.findByRole('alert')).toHaveTextContent('3–20 characters');
      fireEvent.change(field, { target: { value: 'bad name!' } });
      click(WEB_COPY.keep);
      expect(await screen.findByText('Letters, numbers and underscores')).toBeInTheDocument();
      expect(m.setUsername).not.toHaveBeenCalled();
    });

    it.each([
      ['taken at the check', async () => m.checkUsernames.mockResolvedValueOnce([{ username: 'Taken_one', status: 'taken' }]), 'This username is already taken.'],
      ['not allowed at the check', async () => m.checkUsernames.mockResolvedValueOnce([{ username: 'Taken_one', status: 'invalid' }]), 'Username is not allowed'],
      ['taken at the write (a race)', async () => { m.checkUsernames.mockResolvedValueOnce([{ username: 'Taken_one', status: 'available' }]); m.setUsername.mockResolvedValue('taken'); }, 'This username is already taken.'],
      ['unknown at the write', async () => { m.checkUsernames.mockResolvedValueOnce(null); m.setUsername.mockResolvedValue(null); }, "Couldn't check right now"],
    ] as const)('%s: its line, the field stays open, no join', async (_label, arrange, line) => {
      renderAuthed();
      await screen.findByLabelText(WEB_COPY.usernameLabel);
      click(WEB_COPY.change);
      fireEvent.change(screen.getByLabelText(WEB_COPY.usernameLabel), { target: { value: 'Taken_one' } });
      await arrange();
      click(WEB_COPY.keep);
      expect(await screen.findByRole('alert')).toHaveTextContent(line);
      expect(screen.getByLabelText(WEB_COPY.usernameLabel)).not.toHaveAttribute('readonly');
      expect(m.joinWithSession).not.toHaveBeenCalled();
    });

    it('"Not you? Sign out" ends the session and returns to the options', async () => {
      renderAuthed();
      await screen.findByLabelText(WEB_COPY.usernameLabel);
      click(WEB_COPY.notYouSignOut);
      expect(await screen.findByRole('button', { name: WEB_COPY.continueApple })).toBeInTheDocument();
      expect(m.signOutLocal).toHaveBeenCalled();
    });
  });

  it('a refusal after sign-in: the heading and the Planner\'s line, no facts, no App Store, no Sign in, session ended', async () => {
    m.previewWithSession.mockResolvedValue({ kind: 'found', league: league({ current_members: 6 }), block: 'league_full' });
    renderAuthed();
    expect(await screen.findByRole('alert')).toHaveTextContent('Stock Scudetto is full. Ask whoever invited you if they can make room.');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('roberto_b invited you to Stock Scudetto');
    expect(screen.queryByText('Managers')).toBeNull();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(m.joinWithSession).not.toHaveBeenCalled();
    await waitFor(() => expect(m.signOutLocal).toHaveBeenCalled());
  });

  it.each([
    ['in progress', { draft_status: 'in_progress' }, 'draft_in_progress'],
    ['drafted', { draft_status: 'completed' }, 'draft_started'],
  ] as const)('a draft %s: "isn\'t taking new players right now."', async (_label, over, block) => {
    m.previewWithSession.mockResolvedValue({ kind: 'found', league: league(over), block });
    renderAuthed();
    expect(await screen.findByRole('alert')).toHaveTextContent("Stock Scudetto isn't taking new players right now.");
  });

  it('the season is over: the same neutral line', async () => {
    m.previewWithSession.mockResolvedValue({ kind: 'found', league: league(), block: 'season_completed' });
    renderAuthed();
    expect(await screen.findByRole('alert')).toHaveTextContent("Stock Scudetto isn't taking new players right now.");
  });

  it('already a member (preview): "You\'re already in {league}.", nothing written', async () => {
    m.previewWithSession.mockResolvedValue({ kind: 'found', league: league(), block: 'already_member' });
    renderAuthed();
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent("You're already in Stock Scudetto.");
    expect(screen.getByText('5 of 6')).toBeInTheDocument(); // they are a member: the facts are theirs to read
    expect(m.joinWithSession).not.toHaveBeenCalled();
    await waitFor(() => expect(m.signOutLocal).toHaveBeenCalled());
  });

  it('the league changed between the preview and the join: join-league is the truth', async () => {
    m.joinWithSession.mockResolvedValue({ kind: 'refused', block: 'league_full', leagueId: null });
    renderAuthed();
    // in THIS flow the full refusal says "whoever invited you", never join-league's "Ask your commissioner"
    expect(await screen.findByRole('alert')).toHaveTextContent('Stock Scudetto is full. Ask whoever invited you if they can make room.');
    expect(screen.queryByText(/commissioner/i)).toBeNull();
  });

  it('a race that makes them a member reads as already in', async () => {
    m.joinWithSession.mockResolvedValue({ kind: 'refused', block: 'already_member', leagueId: 'L1' });
    renderAuthed();
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent("You're already in Stock Scudetto.");
  });

  it('a code that resolves nowhere once signed in: the dead-link line (no heading, no Sign in), session ended', async () => {
    m.previewWithSession.mockResolvedValue({ kind: 'bad_code' });
    renderAuthed();
    expect(await screen.findByRole('alert')).toHaveTextContent(WEB_COPY.inviteLinkDead);
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    await waitFor(() => expect(m.signOutLocal).toHaveBeenCalled());
  });

  it.each([
    ['unreachable', "Couldn't reach the league. Check your connection, then try again."],
    ['rate_limited', 'Too many tries. Wait a moment, then try again.'],
  ] as const)('a %s failure: our line, "Not you? Sign out", and the session is KEPT for a retry', async (error, line) => {
    m.previewWithSession.mockResolvedValue({ kind: 'error', error });
    renderAuthed();
    expect(await screen.findByRole('alert')).toHaveTextContent(line);
    expect(m.signOutLocal).not.toHaveBeenCalled();
    click(WEB_COPY.notYouSignOut);
    expect(await screen.findByRole('button', { name: WEB_COPY.continueApple })).toBeInTheDocument();
    expect(m.signOutLocal).toHaveBeenCalled();
  });

  it('a join transport failure is the same', async () => {
    m.joinWithSession.mockResolvedValue({ kind: 'error', error: 'unreachable' });
    renderAuthed();
    expect(await screen.findByRole('alert')).toHaveTextContent(/Couldn't reach the league/);
  });
});

describe('what the web callback hands back', () => {
  it.each([
    ['expired', WEB_COPY.webLinkExpired, 'alert'],
    ['paused', WEB_COPY.signupsPaused, 'alert'],
    ['generic', WEB_COPY.generic, 'alert'],
    ['confirmed-sign-in', WEB_COPY.confirmedSignIn, 'status'],
  ] as const)('%s: its approved line', async (notice, line, role) => {
    renderFlow({ handoff: { notice } });
    expect(await screen.findByRole(role)).toHaveTextContent(line);
  });

  it('"confirmed, sign in with your password" opens the sign-in form, not the options', async () => {
    renderFlow({ handoff: { notice: 'confirmed-sign-in' } });
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(WEB_COPY.signIn);
    expect(screen.getByRole('status')).toHaveTextContent('Your email is confirmed. Sign in with your password.');
  });

  it('the notice goes away once the person acts', async () => {
    renderFlow({ handoff: { notice: 'expired' } });
    await screen.findByRole('alert');
    click(WEB_COPY.useEmail);
    expect(screen.queryByText(WEB_COPY.webLinkExpired)).toBeNull();
  });

  it('a session THIS visit produced (the callback says so) carries straight on to the join', async () => {
    m.currentSession.mockResolvedValue({ userId: 'u1' });
    renderFlow({ handoff: { signedIn: true } });
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent("You're in Stock Scudetto.");
    expect(screen.queryByRole('button', { name: WEB_COPY.continueApple })).toBeNull();
  });

  it('a session found COLD never joins a league on its own: it is ended and the options show', async () => {
    m.currentSession.mockResolvedValue({ userId: 'u1' });
    renderFlow();
    expect(await screen.findByRole('button', { name: WEB_COPY.continueApple })).toBeInTheDocument();
    expect(m.signOutLocal).toHaveBeenCalled();
    expect(m.previewWithSession).not.toHaveBeenCalled();
    expect(m.joinWithSession).not.toHaveBeenCalled();
    expect(m.readOwnUsername).not.toHaveBeenCalled();
  });

  it('a cold session with a notice still shows the notice after ending it', async () => {
    m.currentSession.mockResolvedValue({ userId: 'u1' });
    renderFlow({ handoff: { notice: 'expired' } });
    expect(await screen.findByRole('alert')).toHaveTextContent(WEB_COPY.webLinkExpired);
    expect(m.signOutLocal).toHaveBeenCalled();
  });
});
