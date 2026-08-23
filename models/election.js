const mongoose = require("mongoose");

// Singleton-style document: there is only ever one election configuration.
// Admin sets a title + voting window from /admin/election. If votingStart /
// votingEnd are left null, voting/results behave as "unscheduled" (always
// open) so the app still works out of the box before an admin configures it.
const electionSchema = new mongoose.Schema({
    title: {
        type: String,
        trim: true,
        default: "Student Council Election",
    },
    votingStart: {
        type: Date,
        default: null,
    },
    votingEnd: {
        type: Date,
        default: null,
    },
    // Lets an admin explicitly publish results to students independent of
    // the voting window - e.g. to publish early, or to double check results
    // privately before making them public even after voting closes.
    resultsDeclared: {
        type: Boolean,
        default: false,
    },
    resultsDeclaredAt: {
        type: Date,
        default: null,
    },
}, { timestamps: true });

const Election = mongoose.model("Election", electionSchema);

// Always returns the single election settings document, creating a default
// one on first use.
async function getElectionSettings() {
    let election = await Election.findOne({});
    if (!election) {
        election = await Election.create({});
    }
    return election;
}

// Computes the current phase of the election relative to `now`.
// "unscheduled" -> admin hasn't set a window yet, treat voting as always open
// "upcoming"    -> before votingStart
// "live"        -> between votingStart and votingEnd
// "closed"      -> after votingEnd
function getElectionStatus(election, now = new Date()) {
    if (!election || !election.votingStart || !election.votingEnd) {
        return "unscheduled";
    }
    if (now < election.votingStart) return "upcoming";
    if (now > election.votingEnd) return "closed";
    return "live";
}

module.exports = { Election, getElectionSettings, getElectionStatus };
