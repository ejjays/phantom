import { ExtractorError } from './types';

// permanent: retrying the same link won't help
export function notFound(platform: string, noun = 'video'): ExtractorError {
  return new ExtractorError(
    `This ${platform} ${noun} doesn't exist or was removed.`,
    false,
    true
  );
}

export function privateVideo(platform: string, noun = 'video'): ExtractorError {
  return new ExtractorError(
    `This ${platform} ${noun} is private and can't be downloaded.`,
    false,
    true
  );
}

export function loginRequired(
  platform: string,
  noun = 'video'
): ExtractorError {
  return new ExtractorError(
    `This ${platform} ${noun} needs a login, so it can't be downloaded.`,
    false,
    true
  );
}

export function geoBlocked(platform: string, noun = 'video'): ExtractorError {
  return new ExtractorError(
    `This ${platform} ${noun} isn't available in your region.`,
    false,
    true
  );
}

export function ageRestricted(
  platform: string,
  noun = 'video'
): ExtractorError {
  return new ExtractorError(
    `This ${platform} ${noun} is age-restricted and can't be downloaded.`,
    false,
    true
  );
}

export function restricted(
  platform: string,
  reason?: string,
  noun = 'video'
): ExtractorError {
  const suffix = reason ? ` ${reason}` : '';
  return new ExtractorError(
    `This ${platform} ${noun} is restricted${suffix} and can't be downloaded.`,
    false,
    true
  );
}

export function noVideo(platform: string, noun = 'video'): ExtractorError {
  return new ExtractorError(
    `Couldn't find a downloadable ${noun} at this ${platform} link.`,
    false
  );
}

// transient: worth a retry
export function networkError(platform: string): ExtractorError {
  return new ExtractorError(
    `Couldn't reach ${platform}. Check your connection and try again.`,
    true,
    true
  );
}

export function rateLimited(platform: string): ExtractorError {
  return new ExtractorError(
    `${platform} is busy right now. Try again in a moment.`,
    true
  );
}

export function serverError(platform: string): ExtractorError {
  return new ExtractorError(
    `${platform} ran into a server error. Try again shortly.`,
    true
  );
}

export function temporaryError(
  platform: string,
  noun = 'video'
): ExtractorError {
  return new ExtractorError(
    `Couldn't load this ${platform} ${noun}. Please try again.`,
    true
  );
}

// map http status to the right typed error
export function fromStatus(
  status: number,
  platform: string,
  noun = 'video'
): ExtractorError {
  if (status === 404 || status === 410) return notFound(platform, noun);
  if (status === 401 || status === 403) return loginRequired(platform, noun);
  if (status === 429) return rateLimited(platform);
  if (status >= 500) return serverError(platform);
  return noVideo(platform, noun);
}

// re-throw typed errors as-is, classify everything else
export function classifyThrown(
  error: unknown,
  platform: string,
  noun = 'video'
): ExtractorError {
  if (error instanceof ExtractorError) return error;
  const msg = error instanceof Error ? error.message : String(error);
  if (/network|fetch|timeout|connection|abort|socket/iu.test(msg)) {
    return networkError(platform);
  }
  return temporaryError(platform, noun);
}
