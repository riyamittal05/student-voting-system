const mongoose = require("mongoose");

const candidateSchema = new mongoose.Schema({

    name: {
        type: String,
        required: true,
        trim: true,
    },

    age: {
        type: Number,
        min: [1, "Age must be a positive number"],
    },

    className: {
        type: String,
        trim: true,
    },

    position: {
        type: String,
        required: true,
        trim: true,
    },

    votes: {
        type: Number,
        default: 0,
        min: 0,
    },

    image: {
        type: String,
        default: "https://cdn-icons-png.flaticon.com/512/149/149071.png",
    },

    // Cloudinary public_id, kept so the old image can be removed from
    // Cloudinary when a candidate's photo is updated or the candidate is deleted.
    imagePublicId: {
        type: String,
        default: null,
    },

}, { timestamps: true });

const Candidate = mongoose.model("Candidate", candidateSchema);

module.exports = Candidate;