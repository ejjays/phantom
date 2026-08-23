import { describe, it, expect } from 'vitest';
import { extractFromJson } from '@phantom/extractors/facebook/json-extractor';

const jsonScript = (payload: unknown): string =>
  `<html><script type="application/json">${JSON.stringify(payload)}</script></html>`;

describe('facebook extractFromJson', () => {
  it('pulls hd/sd urls plus title, uploader and thumbnail', () => {
    const html = jsonScript({
      node: {
        browser_native_hd_url: 'https://v.example/hd.mp4',
        browser_native_sd_url: 'https://v.example/sd.mp4',
        owner: { name: 'Page Name' },
        message: { text: 'My caption' },
        preferred_thumbnail: { image: { uri: 'https://t.example/thumb.jpg' } },
      },
    });

    const result = extractFromJson(html);
    expect(result).not.toBeNull();
    expect(result?.formats.map((f) => f.format_id)).toEqual(['hd', 'sd']);
    expect(result?.formats[0].url).toBe('https://v.example/hd.mp4');
    expect(result?.title).toBe('My caption');
    expect(result?.uploader).toBe('Page Name');
    expect(result?.thumbnail).toBe('https://t.example/thumb.jpg');
  });

  it('falls back to photo formats when no video is present', () => {
    const html = jsonScript({
      viewer_image: { uri: 'https://p.example/photo.jpg' },
    });

    const result = extractFromJson(html);
    expect(result?.formats).toHaveLength(1);
    expect(result?.formats[0].format_id).toBe('photo');
    expect(result?.formats[0].ext).toBe('jpeg');
  });

  it('returns null when no media is found', () => {
    expect(extractFromJson(jsonScript({ unrelated: true }))).toBeNull();
  });
});
