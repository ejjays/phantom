export function decodeHtmlEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-fA-F]+|#\d+|amp|quot|lt|gt|apos);/gu,
    (entity, code: string) => {
      if (code.startsWith('#x')) {
        return String.fromCodePoint(parseInt(code.slice(2), 16));
      }
      if (code.startsWith('#')) {
        return String.fromCodePoint(parseInt(code.slice(1), 10));
      }
      switch (code) {
        case 'amp':
          return '&';
        case 'quot':
          return '"';
        case 'lt':
          return '<';
        case 'gt':
          return '>';
        default:
          return "'";
      }
    }
  );
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
