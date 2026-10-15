const { getElectionStatus } = require("../models/election");

describe("getElectionStatus", () => {
    test("returns 'unscheduled' when no election doc exists", () => {
        expect(getElectionStatus(null)).toBe("unscheduled");
    });

    test("returns 'unscheduled' when votingStart/votingEnd are not set", () => {
        expect(getElectionStatus({ votingStart: null, votingEnd: null })).toBe("unscheduled");
    });

    test("returns 'upcoming' before the voting window starts", () => {
        const now = new Date("2026-01-15T12:00:00Z");
        const election = {
            votingStart: new Date("2026-01-16T09:00:00Z"),
            votingEnd: new Date("2026-01-17T09:00:00Z"),
        };
        expect(getElectionStatus(election, now)).toBe("upcoming");
    });

    test("returns 'live' inside the voting window", () => {
        const now = new Date("2026-01-16T15:00:00Z");
        const election = {
            votingStart: new Date("2026-01-16T09:00:00Z"),
            votingEnd: new Date("2026-01-17T09:00:00Z"),
        };
        expect(getElectionStatus(election, now)).toBe("live");
    });

    test("returns 'closed' after the voting window ends", () => {
        const now = new Date("2026-01-18T00:00:00Z");
        const election = {
            votingStart: new Date("2026-01-16T09:00:00Z"),
            votingEnd: new Date("2026-01-17T09:00:00Z"),
        };
        expect(getElectionStatus(election, now)).toBe("closed");
    });

    test("boundary: exactly at votingStart is 'live', not 'upcoming'", () => {
        const start = new Date("2026-01-16T09:00:00Z");
        const election = { votingStart: start, votingEnd: new Date("2026-01-17T09:00:00Z") };
        expect(getElectionStatus(election, start)).toBe("live");
    });

    test("boundary: exactly at votingEnd is still 'live', not 'closed'", () => {
        const end = new Date("2026-01-17T09:00:00Z");
        const election = { votingStart: new Date("2026-01-16T09:00:00Z"), votingEnd: end };
        expect(getElectionStatus(election, end)).toBe("live");
    });
});
