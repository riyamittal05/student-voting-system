const mongoose = require("mongoose");

// Admin-managed allowlist of student roll numbers permitted to create an
// account. Signup only succeeds if the submitted roll number exists here
// AND hasn't been used yet, which stops someone from spinning up unlimited
// fake accounts to vote multiple times - each real roll number can only
// ever back one student account.
const eligibleVoterSchema = new mongoose.Schema({
    rollNumber: {
        type: String,
        required: true,
        trim: true,
        uppercase: true,
        unique: true,
    },
    used: {
        type: Boolean,
        default: false,
    },
    usedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
    },
}, { timestamps: true });

const EligibleVoter = mongoose.model("EligibleVoter", eligibleVoterSchema);
module.exports = EligibleVoter;
