import { buildPageHeaders } from '@phantom/extractors';
import { DESKTOP_UA } from '../../lib/userAgents';

export { DESKTOP_UA };

export const HEADERS = buildPageHeaders(DESKTOP_UA);
