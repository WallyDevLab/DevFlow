const isControl = (ch: string) => {
  const code = ch.charCodeAt(0);
  // C0 controls (including tab and line breaks), DEL, and the Unicode
  // line/paragraph separators.
  return code <= 0x1f || code === 0x7f || code === 0x2028 || code === 0x2029;
};

/**
 * For single-line fields (names, titles): control characters, line breaks and
 * tabs become spaces. Names are copied into emails and notifications, so this
 * stops line breaks being used to forge extra text or headers there.
 */
export const singleLine = ({ value }: { value: unknown }) =>
  typeof value === 'string'
    ? value
        .split('')
        .map((ch) => (isControl(ch) ? ' ' : ch))
        .join('')
        .replace(/ {2,}/g, ' ')
        .trim()
    : value;
