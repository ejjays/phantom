import { SOCIAL_TAP_TYPE } from './pushRender.logic';

export type SocialDeepLink = { updateId: string; commentId: string | null };

// null if payload isn't ours or lacks an updateId.
export function parseSocialTap(
  data: Record<string, unknown> | undefined | null
): SocialDeepLink | null {
  if (!data || data.type !== SOCIAL_TAP_TYPE) return null;
  const updateId = typeof data.updateId === 'string' ? data.updateId : '';
  if (!updateId) return null;
  const commentId =
    typeof data.commentId === 'string' && data.commentId.length > 0
      ? data.commentId
      : null;
  return { updateId, commentId };
}
