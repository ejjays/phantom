import { secureFetch } from '../utils/network/security.util.js';
import { logger } from '../utils/infra/logger.util.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
// fetch chords
export async function getUgChords(
  artist: string,
  title: string
): Promise<{ chordsSheet: string; chordsLink: string } | null> {
  logger.info(`[UG] Searching for: ${artist} - ${title}`);

  try {
    const query = encodeURIComponent(`${artist} ${title} chords`);
    const searchUrl = `https://www.ultimate-guitar.com/search.php?search_type=title&value=${query}`;

    const response = await secureFetch(searchUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
      },
    });

    if (!response.ok) return null;
    const html = await response.text();

    // extract JS
    const dataMatch = html.match(/class="js-store" data-config="([^"]+)"/u);
    if (!dataMatch) return null;

    const dataJson = JSON.parse(dataMatch[1].replace(/&quot;/gu, '"'));
    const results = (dataJson?.store?.page?.data?.results || []) as any[];

    if (results.length === 0) return null;

    // filter for chords
    const bestMatch = results.find(
      (resultItem: any) =>
        resultItem.type === 'Chords' &&
        (resultItem.artist_name?.toLowerCase().includes(artist.toLowerCase()) ||
          resultItem.song_name?.toLowerCase().includes(title.toLowerCase()))
    );

    if (!bestMatch) return null;

    // fetch chords page
    const chordsUrl = bestMatch.tab_url;
    const chordsRes = await secureFetch(chordsUrl);
    const chordsHtml = await chordsRes.text();

    const chordsMatch = chordsHtml.match(
      /class="js-store" data-config="([^"]+)"/u
    );
    if (!chordsMatch) return null;

    const chordsJson = JSON.parse(chordsMatch[1].replace(/&quot;/gu, '"'));
    const content = chordsJson?.store?.page?.data?.tab_view?.wiki_tab?.content;

    return content ? { chordsSheet: content, chordsLink: chordsUrl } : null;
  } catch (error) {
    logger.error('[UG] Scraping failed:', (error as Error).message);
    return null;
  }
}
