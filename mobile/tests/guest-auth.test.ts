import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockApi = vi.hoisted(() => ({
  getSession: vi.fn(),
  signInAnonymously: vi.fn(),
  upsert: vi.fn(),
  maybeSingle: vi.fn(),
  generate: vi.fn(() => 'anonymous30584'),
}));

vi.mock('../src/lib/social/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      getSession: mockApi.getSession,
      signInAnonymously: mockApi.signInAnonymously,
    },
    from: () => ({
      upsert: mockApi.upsert,
      select: () => ({ eq: () => ({ maybeSingle: mockApi.maybeSingle }) }),
    }),
  },
}));

vi.mock('../src/lib/social/updates.logic', async (importActual) => {
  const actual =
    await importActual<typeof import('../src/lib/social/updates.logic')>();
  return { ...actual, generateGuestName: mockApi.generate };
});

import {
  ensureSession,
  signInAsGuest,
  getAccount,
  ensureGuestReady,
} from '../src/lib/social/updates';

function session(user: { id: string; is_anonymous?: boolean } | null) {
  return { data: { session: user ? { user } : null } };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ensureSession', () => {
  it('returns the existing session id without signing in', async () => {
    mockApi.getSession.mockResolvedValue(session({ id: 'me' }));
    expect(await ensureSession()).toBe('me');
    expect(mockApi.signInAnonymously).not.toHaveBeenCalled();
    expect(mockApi.maybeSingle).not.toHaveBeenCalled();
  });

  it('does not create a session for signed-out users', async () => {
    mockApi.getSession.mockResolvedValue(session(null));

    await expect(ensureSession()).rejects.toThrow(/sign in/iu);
    expect(mockApi.signInAnonymously).not.toHaveBeenCalled();
    expect(mockApi.upsert).not.toHaveBeenCalled();
  });

  it('repairs a stale anonymous session that lacks a profile row', async () => {
    mockApi.getSession.mockResolvedValue(
      session({ id: 'guest1', is_anonymous: true })
    );
    mockApi.maybeSingle.mockResolvedValue({ data: null, error: null });
    mockApi.upsert.mockResolvedValue({ error: null });

    expect(await ensureSession()).toBe('guest1');
    expect(mockApi.signInAnonymously).not.toHaveBeenCalled();
    expect(mockApi.upsert).toHaveBeenCalledWith({
      id: 'guest1',
      username: 'anonymous30584',
      avatar_url: expect.stringMatching(/^preset:/u),
    });
  });

  it('keeps an existing guest profile row untouched', async () => {
    mockApi.getSession.mockResolvedValue(
      session({ id: 'guest1', is_anonymous: true })
    );
    mockApi.maybeSingle.mockResolvedValue({
      data: { id: 'guest1' },
      error: null,
    });

    expect(await ensureSession()).toBe('guest1');
    expect(mockApi.upsert).not.toHaveBeenCalled();
  });

  it('retries the profile row with a fresh name on a taken handle', async () => {
    mockApi.getSession.mockResolvedValue(session(null));
    mockApi.signInAnonymously.mockResolvedValue({
      data: { user: { id: 'guest1' } },
      error: null,
    });
    mockApi.maybeSingle.mockResolvedValue({ data: null, error: null });
    mockApi.generate
      .mockImplementationOnce(() => 'anonymous11111')
      .mockImplementationOnce(() => 'anonymous22222')
      .mockImplementationOnce(() => 'anonymous33333');
    mockApi.upsert
      .mockResolvedValueOnce({ error: { code: '23505' } })
      .mockResolvedValueOnce({ error: { code: '23505' } })
      .mockResolvedValue({ error: null });

    expect(await signInAsGuest()).toBe('guest1');
    expect(mockApi.upsert).toHaveBeenCalledTimes(3);
    expect(mockApi.upsert.mock.calls.map(([row]) => row.username)).toEqual([
      'anonymous11111',
      'anonymous22222',
      'anonymous33333',
    ]);
  });

  it('throws when anonymous sign-in fails', async () => {
    mockApi.getSession.mockResolvedValue(session(null));
    mockApi.signInAnonymously.mockResolvedValue({
      data: { user: null },
      error: new Error('signup disabled'),
    });
    await expect(signInAsGuest()).rejects.toThrow(/signup disabled/u);
  });
});

describe('ensureGuestReady', () => {
  it('heals a guest profile before push token registration', async () => {
    mockApi.getSession.mockResolvedValue(
      session({ id: 'guest1', is_anonymous: true })
    );
    mockApi.maybeSingle.mockResolvedValue({ data: null, error: null });
    mockApi.upsert.mockResolvedValue({ error: null });

    await ensureGuestReady('guest1');
    expect(mockApi.upsert).toHaveBeenCalledTimes(1);
  });

  it('no-ops for google accounts', async () => {
    mockApi.getSession.mockResolvedValue(
      session({ id: 'me', is_anonymous: false })
    );
    await ensureGuestReady('me');
    expect(mockApi.maybeSingle).not.toHaveBeenCalled();
    expect(mockApi.upsert).not.toHaveBeenCalled();
  });
});

describe('getAccount', () => {
  it('returns a guest account for anonymous sessions', async () => {
    mockApi.getSession.mockResolvedValue(
      session({ id: 'guest1', is_anonymous: true })
    );
    mockApi.maybeSingle.mockResolvedValue({
      data: { username: 'anonymous30584', avatar_url: null },
      error: null,
    });
    expect(await getAccount()).toEqual({
      userId: 'guest1',
      username: 'anonymous30584',
      name: null,
      email: null,
      avatarUrl: null,
      isGuest: true,
    });
  });

  it('returns a google account for signed-in sessions', async () => {
    mockApi.getSession.mockResolvedValue(
      session({ id: 'me', is_anonymous: false })
    );
    mockApi.maybeSingle.mockResolvedValue({
      data: { username: 'alice', avatar_url: null },
      error: null,
    });
    const acc = await getAccount();
    expect(acc?.isGuest).toBe(false);
    expect(acc?.username).toBe('alice');
  });

  it('returns null with no session', async () => {
    mockApi.getSession.mockResolvedValue(session(null));
    expect(await getAccount()).toBeNull();
  });
});
