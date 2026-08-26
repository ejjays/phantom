import ReactNativeBlobUtil from 'react-native-blob-util';

export interface RawResponse {
  ok: boolean;
  status: number;
  headers?: Record<string, string>;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
}

// react-native fetch (Android OkHttp ForwardingCookieJar) drops manually-set Cookie
// headers for hosts jar hasn't seen, so injected IG login cookie never reaches
// server. react-native-blob-util uses own OkHttp client (no jar) -> headers
// pass through verbatim.
export async function cookieGet(
  url: string,
  headers: Record<string, string>
): Promise<RawResponse> {
  const res = await ReactNativeBlobUtil.config({}).fetch('GET', url, headers);
  const status = res.info().status;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: (res.info().headers ?? {}) as Record<string, string>,
    text: () => Promise.resolve(res.text()),
    json: () => Promise.resolve(res.json() as unknown),
  };
}
