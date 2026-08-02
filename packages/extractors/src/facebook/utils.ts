export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/gu, (_match, hex) =>
      String.fromCodePoint(parseInt(hex, 16))
    )
    .replace(/&#(\d+);/gu, (_match, dec) =>
      String.fromCodePoint(parseInt(dec, 10))
    )
    .replace(/&amp;/gu, '&')
    .replace(/&quot;/gu, '"')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>');
}

export function decode(text: string): string {
  try {
    if (text.startsWith('"') && text.endsWith('"')) return JSON.parse(text);
    const unescaped = text
      .replace(/\\u([0-9a-fA-F]{4})/gu, (_match, group) =>
        String.fromCharCode(parseInt(group, 16))
      )
      .replace(/\\\//gu, '/')
      .replace(/\\"/gu, '"')
      .replace(/\\\\/gu, '\\');
    return decodeHtmlEntities(unescaped);
  } catch (error) {
    console.debug('Ignored:', (error as Error).message);
    return text.replace(/\\/gu, '').replace(/&amp;/gu, '&');
  }
}
