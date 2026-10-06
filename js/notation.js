// Rubik's Snake notation parser.
//
// Notation rules (from thomas-wolter.de/rubik_notation_en.html):
// The snake is a chain of 24 triangular-prism "wedges". Lay the snake
// straight and you can identify 12 "dark" pieces (odd look-and-feel,
// numbered 1-12 left to right) each fused to a "bright" piece on one or
// both sides. Piece 1 only has a bright neighbour on its right; every
// other dark piece (2-12) has a bright neighbour on both its left (L)
// and right (R) side. That gives 23 addressable joints: 1R, 2L, 2R, 3L,
// 3R, ... 12L, 12R.
//
// Each joint can be twisted into 4 positions relative to the straight
// "base" position: base (0 / untwisted), and three 90 degree steps
// named 1, 2, 3. A notation instruction is "<piece><L|R><position>",
// e.g. "11L1". Instructions are chained with "-".
//
// Quirk preserved from the original implementation: a quarter turn
// specified on the "R" side of a joint physically corresponds to the
// opposite rotation direction of the same amount specified on the "L"
// side, so position 1 and 3 are swapped when the side is "R" before the
// angle is applied to the underlying rotation axis. This keeps every
// joint's raw angle expressed consistently around the same local axis.

export const NUM_SEGMENTS = 24;

// Ordered exactly like the chain: index == array position used by the
// geometry/animation code, 0..22 (index 23 has no joint - it would be
// the far/last end of the snake).
export const JOINT_KEYS = [
  '1R',
  '2L', '2R',
  '3L', '3R',
  '4L', '4R',
  '5L', '5R',
  '6L', '6R',
  '7L', '7R',
  '8L', '8R',
  '9L', '9R',
  '10L', '10R',
  '11L', '11R',
  '12L', '12R',
];

export const JOINT_INDEX = Object.fromEntries(JOINT_KEYS.map((k, i) => [k, i]));

const TOKEN_RE = /^(\d{1,2})\s*(L|R)\s*(\d?)$/i;

/**
 * Parse a single instruction token, e.g. "11L1", "12R", "2r3".
 * Returns null if the token doesn't address a valid joint - mirrors the
 * original site's lenient parser, which silently ignores anything it
 * can't fully understand (missing digit, out-of-range piece number, ...).
 */
export function parseToken(token) {
  const trimmed = token.trim();
  if (!trimmed) return null;

  const m = TOKEN_RE.exec(trimmed);
  if (!m) return null;

  const pieceNum = parseInt(m[1], 10);
  const side = m[2].toUpperCase();
  const key = `${pieceNum}${side}`;

  if (!(key in JOINT_INDEX)) return null;

  const rawDigit = m[3];
  if (rawDigit === '') return null; // no orientation digit -> ignored, same as upstream parseInt('') => NaN

  let quarterTurns = parseInt(rawDigit, 10);
  if (quarterTurns < 0 || quarterTurns > 3) return null;

  // R-side quirk: swap positions 1 and 3 so every joint's stored value
  // is measured consistently around the same fixed local axis.
  if (side === 'R') {
    if (quarterTurns === 1) quarterTurns = 3;
    else if (quarterTurns === 3) quarterTurns = 1;
  }

  return {
    raw: trimmed,
    key,
    index: JOINT_INDEX[key],
    side,
    pieceNum,
    quarterTurns,
    angle: (quarterTurns * Math.PI) / 2,
  };
}

/**
 * Split a full notation string into step objects, in the exact order
 * given (order matters for animation, not for the final resolved shape).
 * Malformed/unrecognised tokens are skipped, matching the original
 * parser's behaviour.
 */
export function parseSteps(humanNotation) {
  if (!humanNotation) return [];
  return humanNotation
    .split(/-/g)
    .map((tok) => tok.replace(/<wbr\s*\/?>/gi, ''))
    .map(parseToken)
    .filter((step) => step !== null);
}

/**
 * Resolve the joint-angle state (Float64Array length NUM_SEGMENTS) after
 * applying the first `count` steps of `steps`, in order. Later
 * occurrences of the same joint overwrite earlier ones, exactly like a
 * physical snake re-twisted at the same hinge.
 */
export function computeStateAfterSteps(steps, count) {
  const angles = new Float64Array(NUM_SEGMENTS);
  const n = Math.max(0, Math.min(count, steps.length));
  for (let i = 0; i < n; i++) {
    angles[steps[i].index] = steps[i].angle;
  }
  return angles;
}

export function finalAngles(humanNotation) {
  const steps = parseSteps(humanNotation);
  return computeStateAfterSteps(steps, steps.length);
}

/** Normalize a notation string for display: strip whitespace oddities. */
export function cleanNotation(humanNotation) {
  return (humanNotation || '')
    .replace(/<wbr\s*\/?>/gi, '')
    .split(/-/g)
    .map((s) => s.trim())
    .filter((s) => s.length)
    .join('-');
}

/** Validate a notation string, returning {valid, steps, invalidTokens}. */
export function validateNotation(humanNotation) {
  const rawTokens = (humanNotation || '').split(/-/g).map((t) => t.replace(/<wbr\s*\/?>/gi, '').trim()).filter((t) => t.length);
  const invalidTokens = [];
  const steps = [];
  for (const tok of rawTokens) {
    const parsed = parseToken(tok);
    if (parsed === null) {
      invalidTokens.push(tok);
    } else {
      steps.push(parsed);
    }
  }
  return { valid: invalidTokens.length === 0 && steps.length > 0, steps, invalidTokens };
}
