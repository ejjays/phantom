export function computeLift(
  fieldBottom: number,
  keyboardHeight: number,
  screenH: number,
  bottomInset: number
): number {
  'worklet';
  if (keyboardHeight <= 0 || fieldBottom <= 0) return 0;
  const needed = fieldBottom + bottomInset + 10 - (screenH - keyboardHeight);
  return needed > 0 ? -needed : 0;
}
