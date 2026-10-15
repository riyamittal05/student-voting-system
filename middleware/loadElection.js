const { getElectionSettings, getElectionStatus } = require("../models/election");

// Attaches the current election settings + computed phase to res.locals so
// every view (navbar countdown, home status badge, vote page, results page)
// can read them without each route re-fetching them separately.
async function loadElection(req, res, next) {
    try {
        const election = await getElectionSettings();
        res.locals.election = election;
        res.locals.electionStatus = getElectionStatus(election);
    } catch (err) {
        res.locals.election = null;
        res.locals.electionStatus = "unscheduled";
    }
    next();
}

module.exports = loadElection;
