const crypto = require("crypto");

// Randomizing candidate display order fights "position bias" (real election
// research shows candidates listed first get a measurable vote bump). But we
// don't want a *fresh* random order on every page load - that's confusing
// and makes the page feel broken - so the order is seeded from
// (voterId + position) via a hash. That makes it:
//   - random and different from one voter to the next
//   - different across positions for the same voter
//   - stable across repeated visits for the same voter/position
//   - impossible for a voter to predict/game before seeing the page

function seededRandom(seed) {
    // xorshift32 seeded from the first 4 bytes of a hash - fast, deterministic,
    // good enough for shuffling a short candidate list (not cryptographic use).
    let state = seed || 1;
    return function next() {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        state >>>= 0;
        return state / 4294967296;
    };
}

function seedFromString(str) {
    const hash = crypto.createHash("sha256").update(str).digest();
    return hash.readUInt32BE(0);
}

/**
 * Returns a new array with `items` shuffled deterministically for the given
 * voterId (e.g. student's user id) and position name.
 */
function shuffleForVoter(items, voterId, position) {
    const rand = seededRandom(seedFromString(`${voterId}:${position}`));
    const arr = items.slice();
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

module.exports = { shuffleForVoter };
