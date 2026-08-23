require("dotenv").config();

const express = require("express");
const flash = require("connect-flash");
const mongoose = require("mongoose");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const upload = require("./middleware/multer");
const Candidate = require("./models/candidate");
const app = express();
app.set("trust proxy", 1);
const methodOverride = require("method-override");
const session = require("express-session");
const bcrypt = require("bcrypt");
const User = require("./models/user");
const { cloudinary } = require("./cloudConfig");
const mongoSanitize = require("./middleware/sanitize");
const { attachToken, verifyToken } = require("./middleware/csrf");
const loadElection = require("./middleware/loadElection");
const { Election, getElectionSettings, getElectionStatus } = require("./models/election");
const EligibleVoter = require("./models/eligibleVoter");
const { shuffleForVoter } = require("./utils/ballotOrder");
const { validateEmail, assignOtp, checkOtp, resendCooldownRemaining, sendOtpEmail } = require("./utils/otp");

app.set("view engine", "ejs");
app.set("views", __dirname + "/views");

// Helmet sets a batch of security-related HTTP headers (CSP, no-sniff,
// frameguard, etc). CSP is relaxed for the bits this app actually needs:
// Tailwind's CDN script and inline <script> blocks used for countdowns.
app.use(
    helmet({
        contentSecurityPolicy: {
            directives: {
                ...helmet.contentSecurityPolicy.getDefaultDirectives(),
                "script-src": ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com"],
                "img-src": ["'self'", "data:", "https://res.cloudinary.com", "https://cdn-icons-png.flaticon.com"],
            },
        },
    })
);

app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static("uploads"));

if (!process.env.SECRET || !process.env.MONGO_URL) {
    console.error("Missing required environment variables. Check your .env file (see .env.example).");
    process.exit(1);
}

// Rate limiters - separate from the roll-number allowlist, these stop
// scripted brute-force / credential-stuffing attempts against login and
// signup regardless of whether the attacker has a valid roll number.
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: "Too many attempts from this device. Please wait a few minutes and try again.",
    handler: (req, res) => {
        req.flash("error", "Too many attempts. Please wait a few minutes and try again.");
        res.redirect(req.originalUrl.startsWith("/signup") ? "/signup" : "/login");
    },
});

// Slightly tighter limiter on voting itself - a real student can only ever
// submit a handful of votes (one per post), so a burst of requests here is
// almost certainly a script, not a person.
const voteLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        req.flash("error", "Too many voting requests. Please slow down.");
        res.redirect("/vote");
    },
});

app.use(session({
    secret: process.env.SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 1000 * 60 * 60 * 24, // 1 day
        httpOnly: true,
        secure: process.env.NODE_ENV === "production", // HTTPS-only cookies in prod
    }
}));

app.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
});

app.use(flash());
app.use(mongoSanitize);
app.use(attachToken);

app.use(async (req, res, next) => {
    res.locals.success = req.flash("success");
    res.locals.error = req.flash("error");
    if (req.session.userId) {
        try {
            res.locals.currentUser = await User.findById(req.session.userId);
        } catch (err) {
            res.locals.currentUser = null;
        }
    } else {
        res.locals.currentUser = null;
    }
    next();
});

app.use(methodOverride("_method"));
app.use(loadElection);

main()
    .then(() => console.log("MongoDB connection successful"))
    .catch((err) => {
        console.error("MongoDB connection failed:", err.message);
        process.exit(1);
    });

async function main() {
    await mongoose.connect(process.env.MONGO_URL);
}

// ---------- AUTH MIDDLEWARE ----------

const isLoggedIn = (req, res, next) => {
    if (!req.session.userId) {
        req.flash("error", "Please login first");
        return res.redirect("/login");
    }
    next();
};

const isAdmin = async (req, res, next) => {
    if (!req.session.userId) {
        req.flash("error", "Please login first");
        return res.redirect("/login");
    }
    const user = await User.findById(req.session.userId);
    if (!user) {
        req.session.destroy(() => {});
        req.flash("error", "Please login again");
        return res.redirect("/login");
    }
    if (user.role !== "admin") {
        req.flash("error", "Access Denied");
        return res.redirect("/");
    }
    next();
};

const isStudent = async (req, res, next) => {
    if (!req.session.userId) {
        req.flash("error", "Please login first");
        return res.redirect("/login");
    }
    const user = await User.findById(req.session.userId);
    if (!user) {
        req.session.destroy(() => {});
        req.flash("error", "Please login again");
        return res.redirect("/login");
    }
    if (user.role !== "student") {
        req.flash("error", "Only students can vote");
        return res.redirect("/");
    }
    if (!user.emailVerified) {
        req.flash("error", "Please verify your email before voting. We can resend the code if you need it.");
        return res.redirect(`/verify-email?email=${encodeURIComponent(user.email)}`);
    }
    req.currentDbUser = user;
    next();
};

// tiny helper so a wrapped async route forwards errors to the error handler
const wrapAsync = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// Matches a new/edited candidate's position against existing positions
// case-insensitively, reusing the existing spelling if one matches. Stops
// "President" / "president" / " President " from becoming separate ballot
// posts that silently split the vote.
async function normalizePosition(rawPosition) {
    const trimmed = rawPosition.trim();
    if (!trimmed) return trimmed;
    const existing = await Candidate.distinct("position");
    const match = existing.find((p) => p.toLowerCase() === trimmed.toLowerCase());
    return match || trimmed;
}

// ---------- CANDIDATES (ADMIN) ----------

app.get("/candidates/new", isAdmin, (req, res) => {
    res.render("new.ejs", { error: null });
});

app.post("/candidates", isAdmin, verifyToken, upload.single("image"), wrapAsync(async (req, res) => {
    try {
        let { name, age, className, position } = req.body;

        if (!name || !position) {
            throw new Error("Name and position are required");
        }
        if (age !== undefined && age !== "" && (isNaN(Number(age)) || Number(age) <= 0)) {
            throw new Error("Age must be a positive number");
        }

        // Normalize against existing positions case-insensitively so "president"
        // and "President" don't silently become two different ballot posts and
        // split votes. If a case-insensitive match already exists, reuse its
        // exact spelling instead of creating a near-duplicate.
        position = await normalizePosition(position);

        const newCandidate = new Candidate({
            name,
            age: age || undefined,
            className,
            position,
            image: req.file ? req.file.path : undefined,
            imagePublicId: req.file ? req.file.filename : undefined,
        });
        await newCandidate.save();
        req.flash("success", "Candidate added successfully");
        res.redirect("/");
    } catch (err) {
        res.render("new.ejs", {
            error: err.message || "Something went wrong while adding the candidate",
        });
    }
}));

app.get("/candidates/:id/edit", isAdmin, wrapAsync(async (req, res) => {
    const candidate = await Candidate.findById(req.params.id);
    if (!candidate) {
        req.flash("error", "Candidate not found");
        return res.redirect("/");
    }
    res.render("edit", { candidate });
}));

app.put("/candidates/:id", isAdmin, verifyToken, upload.single("image"), wrapAsync(async (req, res) => {
    const { id } = req.params;
    const candidate = await Candidate.findById(id);
    if (!candidate) {
        req.flash("error", "Candidate not found");
        return res.redirect("/");
    }

    const updatedData = {
        name: req.body.name,
        age: req.body.age || undefined,
        className: req.body.className,
        position: req.body.position ? await normalizePosition(req.body.position) : candidate.position,
    };

    if (req.file) {
        // remove the old Cloudinary image so we don't leak storage
        if (candidate.imagePublicId) {
            await cloudinary.uploader.destroy(candidate.imagePublicId).catch(() => {});
        }
        updatedData.image = req.file.path;
        updatedData.imagePublicId = req.file.filename;
    }

    await Candidate.findByIdAndUpdate(id, updatedData, { runValidators: true });
    req.flash("success", "Candidate updated successfully");
    res.redirect("/");
}));

app.delete("/candidates/:id", isAdmin, verifyToken, wrapAsync(async (req, res) => {
    const { id } = req.params;
    const candidate = await Candidate.findByIdAndDelete(id);
    if (candidate && candidate.imagePublicId) {
        await cloudinary.uploader.destroy(candidate.imagePublicId).catch(() => {});
    }
    req.flash("success", "Candidate removed");
    res.redirect("/");
}));

// ---------- AUTH ----------

app.get("/signup", (req, res) => {
    res.render("signup");
});

app.post("/signup", authLimiter, verifyToken, wrapAsync(async (req, res) => {
    let { username, email, password, rollNumber } = req.body;

    if (!username || !email || !password || !rollNumber) {
        req.flash("error", "All fields are required, including your roll number");
        return res.redirect("/signup");
    }
    if (password.length < 6) {
        req.flash("error", "Password must be at least 6 characters");
        return res.redirect("/signup");
    }

    const normalizedRoll = rollNumber.trim().toUpperCase();
    const normalizedEmail = email.toLowerCase().trim();

    const emailCheck = await validateEmail(normalizedEmail);
    if (!emailCheck.valid) {
        req.flash("error", emailCheck.reason);
        return res.redirect("/signup");
    }

    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
        req.flash("error", "Email already registered");
        return res.redirect("/signup");
    }

    // Roll number must be on the admin-approved eligible-voter list and not
    // already used by another account. This is what actually stops someone
    // from creating unlimited fake student accounts to vote repeatedly -
    // signup, not just login, is where ballot stuffing gets blocked.
    const eligibleVoter = await EligibleVoter.findOne({ rollNumber: normalizedRoll });
    if (!eligibleVoter) {
        req.flash("error", "This roll number is not on the eligible voters list. Contact the election admin.");
        return res.redirect("/signup");
    }
    if (eligibleVoter.used) {
        req.flash("error", "An account has already been created for this roll number.");
        return res.redirect("/signup");
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const newUser = new User({
        username: username.trim(),
        email: normalizedEmail,
        password: hashedPassword,
        role: "student",
        rollNumber: normalizedRoll,
        emailVerified: false,
    });

    const code = await assignOtp(newUser);
    await newUser.save();

    eligibleVoter.used = true;
    eligibleVoter.usedBy = newUser._id;
    await eligibleVoter.save();

    await sendOtpEmail(newUser.email, code);

    req.session.pendingVerifyEmail = newUser.email;
    req.flash("success", "We've sent a 6-digit verification code to your email. Enter it below to activate your account.");
    res.redirect("/verify-email");
}));

// ---------- EMAIL OTP VERIFICATION ----------

app.get("/verify-email", (req, res) => {
    const email = req.query.email || req.session.pendingVerifyEmail || "";
    res.render("verify-email", { email });
});

app.post("/verify-email", verifyToken, wrapAsync(async (req, res) => {
    const email = (req.body.email || req.session.pendingVerifyEmail || "").toLowerCase().trim();
    const code = (req.body.code || "").trim();

    const user = await User.findOne({ email });
    if (!user) {
        req.flash("error", "Account not found. Please sign up again.");
        return res.redirect("/signup");
    }
    if (user.emailVerified) {
        req.flash("success", "Your email is already verified — please log in.");
        return res.redirect("/login");
    }

    const result = await checkOtp(user, code);
    await user.save(); // persist attempt count even on failure
    if (!result.ok) {
        req.flash("error", result.reason);
        return res.redirect(`/verify-email?email=${encodeURIComponent(email)}`);
    }

    user.emailVerified = true;
    user.otpHash = null;
    user.otpExpires = null;
    user.otpAttempts = 0;
    await user.save();

    delete req.session.pendingVerifyEmail;
    req.flash("success", "Email verified! You can now log in.");
    res.redirect("/login");
}));

app.post("/verify-email/resend", verifyToken, wrapAsync(async (req, res) => {
    const email = (req.body.email || req.session.pendingVerifyEmail || "").toLowerCase().trim();
    const user = await User.findOne({ email });
    if (!user) {
        req.flash("error", "Account not found. Please sign up again.");
        return res.redirect("/signup");
    }
    if (user.emailVerified) {
        req.flash("success", "Your email is already verified — please log in.");
        return res.redirect("/login");
    }

    const wait = resendCooldownRemaining(user);
    if (wait > 0) {
        req.flash("error", `Please wait ${wait}s before requesting another code.`);
        return res.redirect(`/verify-email?email=${encodeURIComponent(email)}`);
    }

    const code = await assignOtp(user);
    await user.save();
    await sendOtpEmail(user.email, code);

    req.flash("success", "A new code has been sent.");
    res.redirect(`/verify-email?email=${encodeURIComponent(email)}`);
}));

app.get("/login", (req, res) => {
    res.render("login.ejs");
});

app.post("/login", authLimiter, verifyToken, wrapAsync(async (req, res) => {
    let { email, password } = req.body;
    if (!email || !password) {
        req.flash("error", "Email and password are required");
        return res.redirect("/login");
    }

    const safeEmail = String(email).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // case-insensitive lookup so accounts created before email-lowercasing
    // was added can still log in
    const user = await User.findOne({ email: new RegExp(`^${safeEmail}$`, "i") });
    // Compare against a dummy hash when the user doesn't exist so response
    // timing doesn't reveal whether an email is registered.
    const validPassword = await bcrypt.compare(
        password,
        user ? user.password : "$2b$12$invalidsaltinvalidsaltinvalidsalu"
    );

    if (!user || !validPassword) {
        req.flash("error", "Invalid email or password");
        return res.redirect("/login");
    }

    req.session.userId = user._id;
    req.flash("success", "Login successful");
    res.redirect("/");
}));

app.get("/logout", (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            req.flash("error", "Error logging out");
            return res.redirect("/");
        }
        res.redirect("/login");
    });
});

// ---------- PUBLIC / STUDENT ----------

app.get("/", wrapAsync(async (req, res) => {
    let search = (req.query.search || "").toString().trim();
    // escape regex special characters so user input can't break the query
    // or be used for a ReDoS attack
    const safeSearch = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const candidates = await Candidate.find({
        name: { $regex: safeSearch, $options: "i" },
    }).sort({ position: 1, name: 1 });

    let totalVotes = 0;
    for (const candidate of candidates) totalVotes += candidate.votes;

    const allPositions = await Candidate.distinct("position");

    res.render("home", { candidates, totalVotes, totalPositions: allPositions.length });
}));

app.get("/vote", isStudent, wrapAsync(async (req, res) => {
    const candidates = await Candidate.find({}).sort({ position: 1, name: 1 });

    // group candidates by position so the vote page can show one ballot
    // section per post and mark positions already voted for
    const positions = {};
    for (const candidate of candidates) {
        if (!positions[candidate.position]) positions[candidate.position] = [];
        positions[candidate.position].push(candidate);
    }

    // Shuffle candidate order within each position, seeded per-voter so the
    // order is random but doesn't jump around on refresh. This removes the
    // "listed first gets more votes" bias that a fixed alphabetical order has.
    for (const position of Object.keys(positions)) {
        positions[position] = shuffleForVoter(positions[position], req.session.userId, position);
    }

    res.render("vote", {
        positions,
        votedPositions: req.currentDbUser.votedPositions,
    });
}));

app.post("/vote/:id", voteLimiter, isStudent, verifyToken, wrapAsync(async (req, res) => {
    // Voting is only allowed once the admin-configured window has opened
    // and before it has closed. "unscheduled" (no window set) keeps the
    // old always-open behaviour so the app still works before an admin
    // configures a schedule.
    if (res.locals.electionStatus === "upcoming") {
        req.flash("error", "Voting hasn't started yet.");
        return res.redirect("/vote");
    }
    if (res.locals.electionStatus === "closed") {
        req.flash("error", "Voting has closed. Check the results page.");
        return res.redirect("/vote");
    }

    const candidate = await Candidate.findById(req.params.id);
    if (!candidate) {
        req.flash("error", "Candidate not found");
        return res.redirect("/vote");
    }

    // The two writes a vote requires - mark the user as having voted for
    // this post, and increment the candidate's tally - are wrapped in a
    // single Mongo transaction. Without this, a crash between steps could
    // leave a vote "cast" for the user but never counted, which is exactly
    // the kind of silent inconsistency a voting system can't tolerate.
    const session = await mongoose.startSession();
    try {
        await session.withTransaction(async () => {
            // atomic check-and-set: only succeeds if this position isn't
            // already in votedPositions, so concurrent double-submits can't
            // both go through
            const updatedUser = await User.findOneAndUpdate(
                { _id: req.session.userId, votedPositions: { $ne: candidate.position } },
                { $push: { votedPositions: candidate.position } },
                { new: true, session }
            );

            if (!updatedUser) {
                throw Object.assign(new Error(`You already voted for ${candidate.position}`), { alreadyVoted: true });
            }

            await Candidate.findByIdAndUpdate(
                candidate._id,
                { $inc: { votes: 1 } },
                { session }
            );
        });
    } catch (err) {
        await session.endSession();
        if (err.alreadyVoted) {
            req.flash("error", err.message);
            return res.redirect("/vote");
        }
        throw err;
    }
    await session.endSession();

    req.flash("success", `Vote for ${candidate.position} submitted successfully.`);
    res.redirect("/vote");
}));

// ---------- RESULTS & ADMIN DASHBOARD ----------

app.get("/results", isLoggedIn, wrapAsync(async (req, res) => {
    const user = await User.findById(req.session.userId);
    const isAdminUser = user && user.role === "admin";
    const election = await getElectionSettings();

    // Students see results once the admin has explicitly declared them, OR
    // (as a sane default so nobody has to remember an extra step) once
    // voting has actually closed. Admins can always preview live results so
    // they can monitor the count as it happens, and can hold results back
    // even after closing by simply not declaring them.
    const resultsHidden = !isAdminUser &&
        !election.resultsDeclared &&
        (res.locals.electionStatus === "upcoming" || res.locals.electionStatus === "live");

    if (resultsHidden) {
        return res.render("results-pending", {});
    }

    const candidates = await Candidate.find({}).sort({ position: 1, votes: -1 });

    let totalVotes = 0;
    const byPosition = {};
    for (const candidate of candidates) {
        totalVotes += candidate.votes;
        if (!byPosition[candidate.position]) byPosition[candidate.position] = [];
        byPosition[candidate.position].push(candidate);
    }

    // winner per position (first entry since each group is sorted by votes desc)
    const winners = {};
    for (const position of Object.keys(byPosition)) {
        winners[position] = byPosition[position][0];
    }

    res.render("results", {
        byPosition,
        totalVotes,
        winners,
        isAdminPreview: isAdminUser && res.locals.electionStatus !== "closed" && !election.resultsDeclared,
        resultsDeclared: election.resultsDeclared,
    });
}));

app.get("/results/export.csv", isAdmin, wrapAsync(async (req, res) => {
    const candidates = await Candidate.find({}).sort({ position: 1, votes: -1 });

    const totalsByPosition = {};
    for (const candidate of candidates) {
        totalsByPosition[candidate.position] = (totalsByPosition[candidate.position] || 0) + candidate.votes;
    }

    const escapeCsv = (value) => `"${String(value).replace(/"/g, '""')}"`;
    const rows = [["Position", "Candidate", "Votes", "Percentage"]];
    for (const candidate of candidates) {
        const total = totalsByPosition[candidate.position] || 0;
        const pct = total > 0 ? ((candidate.votes / total) * 100).toFixed(1) : "0.0";
        rows.push([candidate.position, candidate.name, candidate.votes, `${pct}%`]);
    }
    const csv = rows.map((row) => row.map(escapeCsv).join(",")).join("\r\n");

    res.set("Content-Type", "text/csv");
    res.set("Content-Disposition", "attachment; filename=election-results.csv");
    res.send(csv);
}));

app.get("/admin", isAdmin, wrapAsync(async (req, res) => {
    const totalUsers = await User.countDocuments({ role: "student" });
    const totalCandidates = await Candidate.countDocuments();
    const candidates = await Candidate.find();
    const distinctPositions = await Candidate.distinct("position");

    let totalVotes = 0;
    for (const candidate of candidates) totalVotes += candidate.votes;

    // a student "fully voted" once they've voted in every open position
    const votedStudents = await User.countDocuments({
        role: "student",
        $expr: { $gte: [{ $size: "$votedPositions" }, distinctPositions.length] },
    });

    const votingPercentage = totalUsers === 0 || distinctPositions.length === 0
        ? 0
        : ((votedStudents / totalUsers) * 100).toFixed(1);

    const totalEligibleVoters = await EligibleVoter.countDocuments();
    const usedEligibleVoters = await EligibleVoter.countDocuments({ used: true });

    res.render("admin", {
        totalUsers,
        totalCandidates,
        totalVotes,
        votedStudents,
        votingPercentage,
        totalPositions: distinctPositions.length,
        totalEligibleVoters,
        usedEligibleVoters,
    });
}));

// ---------- ADMIN: ELECTION SCHEDULE ----------

app.get("/admin/election", isAdmin, wrapAsync(async (req, res) => {
    const election = await getElectionSettings();
    res.render("admin-election", { election });
}));

app.post("/admin/election", isAdmin, verifyToken, wrapAsync(async (req, res) => {
    const { title, votingStart, votingEnd } = req.body;

    if (!votingStart || !votingEnd) {
        req.flash("error", "Both a start and end time are required");
        return res.redirect("/admin/election");
    }

    const start = new Date(votingStart);
    const end = new Date(votingEnd);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        req.flash("error", "Invalid date/time");
        return res.redirect("/admin/election");
    }
    if (end <= start) {
        req.flash("error", "The end time must be after the start time");
        return res.redirect("/admin/election");
    }

    const election = await getElectionSettings();
    election.title = (title || "").trim() || election.title;
    election.votingStart = start;
    election.votingEnd = end;
    await election.save();

    req.flash("success", "Election schedule updated");
    res.redirect("/admin/election");
}));

// Explicit publish/unpublish control, independent of the voting window, so
// an admin can publish results the moment they're ready to announce them
// (or hold them back even after voting closes, e.g. to sanity-check first).
app.post("/admin/election/declare-results", isAdmin, verifyToken, wrapAsync(async (req, res) => {
    const election = await getElectionSettings();
    election.resultsDeclared = req.body.action === "declare";
    election.resultsDeclaredAt = election.resultsDeclared ? new Date() : null;
    await election.save();

    req.flash(
        "success",
        election.resultsDeclared ? "Results have been declared and are now public." : "Results have been unpublished."
    );
    res.redirect("/admin/election");
}));

// ---------- ADMIN: MANAGE ADMINS ----------

app.get("/admin/users", isAdmin, wrapAsync(async (req, res) => {
    const users = await User.find({}).sort({ role: -1, username: 1 });
    res.render("admin-users", { users });
}));

app.post("/admin/users/:id/promote", isAdmin, verifyToken, wrapAsync(async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user) {
        req.flash("error", "User not found");
        return res.redirect("/admin/users");
    }
    user.role = "admin";
    // an account can only become admin once it's a real, verified person
    user.emailVerified = true;
    await user.save();
    req.flash("success", `${user.username} (${user.email}) is now an admin.`);
    res.redirect("/admin/users");
}));

app.post("/admin/users/:id/demote", isAdmin, verifyToken, wrapAsync(async (req, res) => {
    if (String(req.params.id) === String(req.session.userId)) {
        req.flash("error", "You can't remove your own admin access.");
        return res.redirect("/admin/users");
    }
    const user = await User.findById(req.params.id);
    if (!user) {
        req.flash("error", "User not found");
        return res.redirect("/admin/users");
    }
    user.role = "student";
    await user.save();
    req.flash("success", `${user.username} is no longer an admin.`);
    res.redirect("/admin/users");
}));

app.post("/admin/election/clear", isAdmin, verifyToken, wrapAsync(async (req, res) => {
    const election = await getElectionSettings();
    election.votingStart = null;
    election.votingEnd = null;
    await election.save();
    req.flash("success", "Schedule cleared - voting is now always open until you set a new window");
    res.redirect("/admin/election");
}));

// ---------- ADMIN: ELIGIBLE VOTERS (ANTI-FRAUD ALLOWLIST) ----------

app.get("/admin/voters", isAdmin, wrapAsync(async (req, res) => {
    const voters = await EligibleVoter.find({}).sort({ createdAt: -1 });
    const usedCount = voters.filter((v) => v.used).length;
    res.render("admin-voters", { voters, usedCount });
}));

app.post("/admin/voters", isAdmin, verifyToken, wrapAsync(async (req, res) => {
    const raw = (req.body.rollNumbers || "");
    // accept comma, space, or newline separated roll numbers
    const candidates = raw.split(/[\s,]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
    const uniqueRolls = [...new Set(candidates)];

    let added = 0;
    let skipped = 0;
    for (const rollNumber of uniqueRolls) {
        try {
            await EligibleVoter.create({ rollNumber });
            added++;
        } catch (err) {
            skipped++; // already exists
        }
    }

    req.flash("success", `Added ${added} roll number${added === 1 ? "" : "s"}${skipped ? `, skipped ${skipped} duplicate${skipped === 1 ? "" : "s"}` : ""}`);
    res.redirect("/admin/voters");
}));

app.delete("/admin/voters/:id", isAdmin, verifyToken, wrapAsync(async (req, res) => {
    const voter = await EligibleVoter.findById(req.params.id);
    if (!voter) {
        req.flash("error", "Not found");
        return res.redirect("/admin/voters");
    }
    if (voter.used) {
        req.flash("error", "Can't remove a roll number that already has an account tied to it");
        return res.redirect("/admin/voters");
    }
    await EligibleVoter.findByIdAndDelete(req.params.id);
    req.flash("success", "Roll number removed");
    res.redirect("/admin/voters");
}));

// ---------- 404 + ERROR HANDLING ----------

app.use((req, res) => {
    res.status(404).render("404");
});

app.use((err, req, res, next) => {
    console.error(err);

    if (err.name === "MulterError" || err.message?.includes("images are allowed")) {
        req.flash("error", err.message);
        return res.redirect(req.get("Referrer") || "/");
    }

    res.status(500).render("500", {
        message: process.env.NODE_ENV === "production" ? "Something went wrong." : err.message,
    });
});

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});