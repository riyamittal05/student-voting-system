const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const userSchema = new Schema({
    username: {
        type: String,
        required: true,
        trim: true,
    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
    },
    password: {
        type: String,
        required: true,
    },
    role: {
        type: String,
        enum: ["student", "admin"],
        default: "student",
    },
    // Student roll number, matched against the EligibleVoter allowlist at
    // signup. sparse+unique lets admin accounts (created via createAdmin.js)
    // exist without one while still guaranteeing no roll number is reused.
    rollNumber: {
        type: String,
        trim: true,
        uppercase: true,
        sparse: true,
        unique: true,
    },
    // Tracks which positions (e.g. "President", "Secretary") this user has
    // already cast a vote for. Replaces the old single "hasVoted" boolean so
    // a student can vote once per position instead of once for the whole election.
    votedPositions: {
        type: [String],
        default: [],
    },
    // Email/OTP verification (see utils/otp.js). Unverified accounts can't
    // log in - this proves the address is real and reachable, and makes it
    // much harder for one person to mass-create fake voter accounts using
    // throwaway addresses.
    emailVerified: {
        type: Boolean,
        default: false,
    },
    otpHash: {
        type: String,
        default: null,
    },
    otpExpires: {
        type: Date,
        default: null,
    },
    otpAttempts: {
        type: Number,
        default: 0,
    },
    otpLastSentAt: {
        type: Date,
        default: null,
    },
});

const User = mongoose.model("User", userSchema);
module.exports = User;