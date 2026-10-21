import { describe, expect, it } from 'vitest';
import {
  buildWatchMedia,
  parseWatchJob,
  watchTitle,
} from '../src/lib/watchHandoff';

const valid = {
  v: 1,
  id: 'watch-1',
  url: 'https://cdn.example.com/master.m3u8?token=abc',
  headers: { Referer: 'https://vixsrc.to/', 'User-Agent': 'okhttp/4.12.0' },
  title: 'Normal People',
  season: 1,
  episode: 2,
  height: 1080,
  saveSubdir: 'PhantomWatch',
  subtitles: [
    { url: 'https://cdn.example.com/en.vtt', lang: 'en', label: 'English' },
  ],
};

describe('parseWatchJob', () => {
  it('normalizes a handoff job', () => {
    const job = parseWatchJob(JSON.stringify(valid));
    expect(job).not.toBeNull();
    if (!job) throw new Error('expected job');
    expect(job.title).toBe('Normal People');
    expect(job.headers.Referer).toBe('https://vixsrc.to/');
    expect(job.subtitles[0]?.lang).toBe('en');
    expect(job.isHls).toBe(true);
    expect(watchTitle(job)).toBe('Normal People S01E02');
  });

  it('rejects non-http urls and wrong versions', () => {
    expect(parseWatchJob(JSON.stringify({ ...valid, v: 2 }))).toBeNull();
    expect(
      parseWatchJob(JSON.stringify({ ...valid, url: 'file:///tmp/a.mp4' }))
    ).toBeNull();
  });

  it('drops unsafe headers and subdirs', () => {
    const job = parseWatchJob(
      JSON.stringify({
        ...valid,
        saveSubdir: '../../etc',
        headers: { __proto__: 'x', 'Bad Header': 'x', OK: 'yes' },
        subtitles: [{ url: 'file:///tmp/en.vtt' }],
      })
    );
    expect(job?.saveSubdir).toBe('PhantomWatch');
    expect(job?.headers.OK).toBe('yes');
    expect(job?.headers['Bad Header']).toBeUndefined();
    expect(job?.subtitles).toEqual([]);
  });

  it('builds a direct download format', () => {
    const job = parseWatchJob(JSON.stringify(valid));
    if (!job) throw new Error('expected job');
    const { info, format } = buildWatchMedia(job);
    expect(format.isHls).toBe(true);
    expect(format.height).toBe(1080);
    expect(info.title).toBe('Normal People S01E02');
    expect(info.handoff?.saveSubdir).toBe('PhantomWatch');
  });
});
