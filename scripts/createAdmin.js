// One-off CLI script to create (or promote) an admin account.
//
// Usage:
//   node scripts/createAdmin.js <email> <password> [username]
//
// If a user with that email already exists, it just promotes them to admin
// instead of creating a duplicate account.

require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const User = require("../models/user");

async function run() {
    const [, , email, password, username] = process.argv;

    if (!email || !password) {
        console.log("Usage: node scripts/createAdmin.js <email> <password> [username]");
        process.exit(1);
    }
    if (password.length < 6) {
        console.log("Password must be at least 6 characters");
        process.exit(1);
    }

    await mongoose.connect(process.env.MONGO_URL);

    let user = await User.findOne({ email: email.toLowerCase().trim() });
    const hashedPassword = await bcrypt.hash(password, 12);

    if (user) {
        user.role = "admin";
        user.password = hashedPassword; // also resets password, in case it was forgotten
        user.emailVerified = true;
        await user.save();
        console.log(`Existing user ${email} is now admin, and their password has been reset.`);
    } else {
        user = new User({
            username: username || "admin",
            email: email.toLowerCase().trim(),
            password: hashedPassword,
            role: "admin",
            emailVerified: true,
        });
        await user.save();
        console.log(`Admin account created for ${email}.`);
    }

    await mongoose.disconnect();
}

run().catch((err) => {
    console.error(err);
    process.exit(1);
});