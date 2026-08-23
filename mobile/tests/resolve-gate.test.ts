import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/lib/settings', () => ({
  getGenericSnifferEnabled: vi.fn(() => false),
}));

vi.mock('../src/lib/webviewExtraction/host', () => ({
  extractFromPage: vi.fn(() => null),
}));

vi.mock('../src/lib/webviewExtraction/normalize', () => ({
  pageScanToVideoInfo: vi.fn(() => null),
}));

vi.mock('@sentry/react-native', () => ({
  captureException: vi.fn(),
  withScope: vi.fn((fn) => fn({ setExtra: vi.fn(), setTag: vi.fn() })),
}));

vi.mock('../src/lib/authFetch', () => ({
  cookieGet: vi.fn(),
}));

import { getGenericSnifferEnabled } from '../src/lib/settings';
import { extractFromPage } from '../src/lib/webviewExtraction/host';
import { resolve } from '../src/extractors/index';

const mockedEnabled = vi.mocked(getGenericSnifferEnabled);
const mockedExtract = vi.mocked(extractFromPage);

describe('generic webview fallback gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('unknown host + toggle off → returns null without touching the sniffer', async () => {
    mockedEnabled.mockResolvedValue(false);
    const result = await resolve('https://some-random-site.example/watch');
    expect(result).toBeNull();
    expect(mockedExtract).not.toHaveBeenCalled();
  });

  it('unknown host + toggle on → runs the sniffer fallback', async () => {
    mockedEnabled.mockResolvedValue(true);
    const result = await resolve('https://some-random-site.example/watch');
    expect(mockedExtract).toHaveBeenCalledTimes(1);
    expect(mockedExtract).toHaveBeenCalledWith(
      'https://some-random-site.example/watch',
      expect.any(Function)
    );
    expect(result).toBeNull();
  });
});