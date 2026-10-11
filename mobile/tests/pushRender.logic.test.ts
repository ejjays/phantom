import { describe, it, expect } from 'vitest';
import {
  SOCIAL_CHANNEL,
  socialFcmConfig,
  hasRenderablePayload,
} from '../src/lib/push/pushRender.logic';

describe('hasRenderablePayload', () => {
  it('renders when a notifee_options blob is present', () => {
    expect(hasRenderablePayload({ notifee_options: '{"_v":1}' })).toBe(true);
  });

  it('renders when data carries a plain title', () => {
    expect(hasRenderablePayload({ title: 'hi' })).toBe(true);
  });

  it('renders from a bare notification title/body', () => {
    expect(hasRenderablePayload(undefined, { title: 'hey' })).toBe(true);
    expect(hasRenderablePayload(undefined, { body: 'yo' })).toBe(true);
  });

  it('skips a silent control ping (no content)', () => {
    expect(hasRenderablePayload({ kind: 'ping' })).toBe(false);
    expect(hasRenderablePayload(undefined, undefined)).toBe(false);
    expect(hasRenderablePayload(undefined, {})).toBe(false);
  });
});

describe('socialFcmConfig', () => {
  it('defaults to the social channel with a default press action', () => {
    const config = socialFcmConfig();
    expect(config.defaultChannelId).toBe(SOCIAL_CHANNEL);
    expect(config.defaultPressAction?.id).toBe('default');
    expect(config.fallbackBehavior).toBe('display');
  });
});
