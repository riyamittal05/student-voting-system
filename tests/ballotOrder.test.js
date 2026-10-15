const { shuffleForVoter } = require("../utils/ballotOrder");

const CANDIDATES = ["Alice", "Bob", "Carol", "Dave", "Eve"];

describe("shuffleForVoter", () => {
    test("returns the same order on repeated calls for the same voter+position", () => {
        const order1 = shuffleForVoter(CANDIDATES, "voter-1", "President");
        const order2 = shuffleForVoter(CANDIDATES, "voter-1", "President");
        expect(order1).toEqual(order2);
    });

    test("does not mutate the original array", () => {
        const original = [...CANDIDATES];
        shuffleForVoter(CANDIDATES, "voter-1", "President");
        expect(CANDIDATES).toEqual(original);
    });

    test("contains exactly the same items, just reordered", () => {
        const order = shuffleForVoter(CANDIDATES, "voter-1", "President");
        expect(order.slice().sort()).toEqual(CANDIDATES.slice().sort());
        expect(order).toHaveLength(CANDIDATES.length);
    });

    test("different voters tend to get different orders", () => {
        // not a strict guarantee for every possible seed, but with 5 items
        // and many distinct voter ids, at least one pair should differ
        const orders = new Set();
        for (let i = 0; i < 20; i++) {
            orders.add(shuffleForVoter(CANDIDATES, `voter-${i}`, "President").join(","));
        }
        expect(orders.size).toBeGreaterThan(1);
    });

    test("the same voter gets a different order for a different position", () => {
        const presidentOrder = shuffleForVoter(CANDIDATES, "voter-1", "President");
        const secretaryOrder = shuffleForVoter(CANDIDATES, "voter-1", "Secretary");
        // extremely likely to differ given a 5-item list and independent seeds;
        // this isn't guaranteed for every possible hash collision but is a
        // reasonable smoke test
        expect(presidentOrder.join(",")).not.toBe(secretaryOrder.join(","));
    });

    test("handles a single-candidate list without error", () => {
        expect(shuffleForVoter(["Solo"], "voter-1", "President")).toEqual(["Solo"]);
    });

    test("handles an empty list without error", () => {
        expect(shuffleForVoter([], "voter-1", "President")).toEqual([]);
    });
});
