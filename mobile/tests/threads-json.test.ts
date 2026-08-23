import { describe, it, expect } from 'vitest';
import { extractFromJson } from '@phantom/extractors/threads/json-extractor';

const jsonScript = (payload: unknown): string =>
  `<html><script type="application/json">${JSON.stringify(payload)}</script></html>`;

describe('threads extractFromJson', () => {
  it('picks the highest-resolution video version with caption and author', () => {
    const html = jsonScript({
      post: {
        video_versions: [
          { url: 'https://v.example/low.mp4', width: 480, height: 854 },
          { url: 'https://v.example/hd.mp4', width: 1080, height: 1920 },
        ],
        caption: { text: 'hi there' },
        user: { full_name: 'Jane Doe' },
      },
    });

    const result = extractFromJson(html);
    expect(result?.formats[0].format_id).toBe('hd');
    expect(result?.formats[0].url).toBe('https://v.example/hd.mp4');
    expect(result?.formats[0].width).toBe(1080);
    expect(result?.title).toBe('hi there');
    expect(result?.uploader).toBe('Jane Doe');
  });

  it('falls back to the best image candidate when no video exists', () => {
    const html = jsonScript({
      image_versions2: {
        candidates: [
          { url: 'https://i.example/sm.jpg', width: 320 },
          { url: 'https://i.example/lg.jpg', width: 1080 },
        ],
      },
    });

    const result = extractFromJson(html);
    expect(result?.formats).toHaveLength(1);
    expect(result?.formats[0].format_id).toBe('photo');
    expect(result?.formats[0].url).toBe('https://i.example/lg.jpg');
  });
});
