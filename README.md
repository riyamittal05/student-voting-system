# 🗳️ Student Voting System

A full-stack web app for running student council elections — students sign up (with email OTP verification), log in, and vote once per post (President, Secretary, etc.), while admins add candidates, schedule the election, and publish results.

Built with **Node.js, Express, MongoDB (Mongoose), EJS, Tailwind CSS, and Cloudinary** for candidate photo storage.

## Features

### Core voting
- 🔐 Secure signup/login with hashed passwords (bcrypt), session-based auth, and a show/hide toggle on every password field
- 📧 **Email OTP verification** — signup checks the email is well-formed and has real mail servers (with an optional `ALLOWED_EMAIL_DOMAIN` lock, e.g. Gmail-only), then emails a 6-digit code the student must enter before their account can log in
- 🎓 **Roll-number allowlist** — admin pre-approves eligible roll numbers; signup only succeeds for an approved, unused roll number, so fake/duplicate student accounts can't be created to stuff the ballot
- 🗳️ **One vote per post** — a student can vote for President _and_ Secretary _and_ Treasurer separately, but only once each, enforced atomically so concurrent double-submits can't both succeed
- ⏰ **Scheduled voting window** — admin sets a start/end time; voting is blocked outside that window, with a live countdown shown to students
- 🎲 **Randomized ballot order** — each student sees candidates within a post in a random (but stable per-student) order, so the person listed first doesn't get an unfair advantage

### Fairness & integrity
- ⚛️ **Atomic vote transactions** — recording the vote and incrementing the candidate's tally happen in a single MongoDB transaction, so a crash mid-vote can never leave the data inconsistent
- 🏆 **Explicit results declaration** — admins can publish results early or hold them back even after voting closes (results still auto-publish on close by default, so nothing extra is required for a normal election)
- 👥 **In-app admin management** — any admin can promote/demote other registered users to admin from `/admin/users`, no CLI required after the first one

### Everything else
- 📊 Live per-post results with a winner highlighted, plus CSV export for admins
- 🖼️ Candidate photo upload straight to Cloudinary (no local file storage headaches)
- 🛠️ Admin dashboard — total students, candidates, votes cast, turnout %, and eligible-voter registration progress
- ✅ Search candidates by name from the home page
- 🛡️ Helmet security headers, CSRF protection on every form, NoSQL-injection sanitization, and rate limiting on login/signup/voting
- 🚫 Custom 404 / 500 error pages instead of raw stack traces
- ✅ Unit test suite (Jest) covering the election-status logic, ballot shuffle, and OTP/email validation
- 🐳 Docker Compose setup for one-command local development, including a MongoDB replica set (required for the vote transaction)

## Tech Stack

| Layer        | Tech                                |
| ------------ | ------------------------------------ |
| Backend      | Node.js, Express 5                   |
| Database     | MongoDB + Mongoose (with transactions)|
| Views        | EJS + Tailwind CSS (CDN)             |
| Auth         | express-session + bcrypt + email OTP |
| Email        | Nodemailer                           |
| File storage | Cloudinary + Multer                  |
| Security     | Helmet, express-rate-limit, custom CSRF |
| Testing      | Jest                                 |

## Getting Started

### Option A — Docker (recommended, fastest to get running)

```bash
cp .env.example .env      # fill in SECRET, Cloudinary keys, and (optionally) SMTP creds
docker compose up --build
```

This starts the app **and** a local MongoDB configured as a single-node replica set (needed for the vote transaction to work — a plain standalone `mongod` can't run transactions). The app is at `http://localhost:8080`. `MONGO_URL` is set automatically by Compose to point at the local Mongo container, so you don't need an Atlas cluster for local development.

Create your first admin inside the running container:

```bash
docker compose exec app node scripts/createAdmin.js you@example.com yourPassword YourName
```

### Option B — Run directly with Node

#### 1. Install dependencies

```bash
npm install
```

#### 2. Set up your environment variables

```bash
cp .env.example .env
```

You'll need:

- A [MongoDB Atlas](https://www.mongodb.com/atlas) cluster for `MONGO_URL` (Atlas clusters are replica sets by default, so vote transactions work out of the box) — or point it at a local replica-set Mongo
- A free [Cloudinary](https://cloudinary.com) account for `CLOUD_NAME`, `CLOUD_API_KEY`, `CLOUD_API_SECRET`
- Any random string for `SECRET`
- **Optional but recommended:** SMTP credentials (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`) so signup OTP codes actually get emailed. If you skip this, the code is printed to the server console instead, so you can still test the whole flow locally.

#### 3. Run the app

```bash
npm start        # or: npm run dev   (auto-restart while developing)
```

The app runs at `http://localhost:8080`.

#### 4. Create your first admin account

Every new signup becomes a "student" by default (that's intentional — students shouldn't be able to self-promote). To create the very first admin:

```bash
npm run create-admin -- youremail@example.com yourpassword YourName
```

After that, any admin can promote other registered users straight from the **Manage Admins** page in the app — the CLI script is only needed once.

## Running the tests

```bash
npm test
```

Runs the Jest suite (`tests/`) covering:
- `models/election.js` — voting-window status transitions (`unscheduled` / `upcoming` / `live` / `closed`), including boundary times
- `utils/ballotOrder.js` — per-voter deterministic shuffling
- `utils/otp.js` — email format/domain/MX validation and OTP generation, expiry, and lockout

These are unit tests against pure logic, so they don't need a database — safe to run anywhere, including CI.

## Setting up an election (as admin)

1. Create your admin account (see above).
2. Log in and go to **Voters** — paste in the roll numbers of everyone allowed to vote. Only students on this list can sign up.
3. Go to **Add Candidate** and add candidates for each post (President, Secretary, etc.). Position names are auto-matched case-insensitively against existing ones, so "president" and "President" won't accidentally split into two posts.
4. Go to **Schedule** and set when voting opens and closes.
5. Students sign up with their roll number + email, verify their email with the OTP code, then log in and vote once the window opens.
6. Results become public automatically once voting closes — or declare them early/hold them back from **Schedule → Result Declaration**.
7. Check **Audit Log** anytime to see who voted for whom and confirm the hash chain hasn't been tampered with.

## How Voting Works

1. A student signs up, verifies their email via OTP, and logs in.
2. On `/vote`, candidates are grouped by post, shown in a random order seeded per-student (so nobody gets an unfair "listed first" boost).
3. The student can cast one vote per post — once voted, that post shows "Already Voted" and the button is disabled. The vote, tally update, and audit-log entry all commit together in one transaction.
4. The student gets a receipt code they can check later at `/verify` to confirm their vote was recorded.
5. Admins view live, per-post results on `/results`, and can export a CSV.

## Project Structure

```
├── app.js                     # Express app & all routes
├── cloudConfig.js             # Cloudinary setup
├── middleware/
│   ├── multer.js               # Image upload handling
│   ├── sanitize.js             # NoSQL-injection guard
│   ├── csrf.js                 # CSRF token generation/verification
│   └── loadElection.js         # Attaches election settings/status to every request
├── models/
│   ├── user.js                 # incl. email verification / OTP fields
│   ├── candidate.js
│   ├── election.js             # incl. resultsDeclared flag
│   ├── eligibleVoter.js
│   └── voteLog.js              # incl. hash chain + receipt code fields
├── utils/
│   ├── hashChain.js             # Tamper-evident audit log hashing + receipts
│   ├── ballotOrder.js           # Per-voter deterministic candidate shuffle
│   └── otp.js                   # Email validation, OTP generation, mailer
├── scripts/
│   └── createAdmin.js          # CLI tool to create/reset the first admin account
├── tests/                      # Jest unit tests
├── views/                      # EJS templates
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

## Notes for Deployment

- Set `NODE_ENV=production` so session cookies are marked `secure` (HTTPS-only) and error pages hide internal error messages.
- Never commit your real `.env` file — it's already in `.gitignore`.
- If you ever paste your `.env` contents somewhere (a chat, a ticket, a zipped upload) treat those credentials as compromised and rotate them — MongoDB password and Cloudinary secret especially.
- Vote transactions require MongoDB to be running as a replica set. MongoDB Atlas clusters are replica sets by default; a bare local `mongod` is not — use the provided `docker-compose.yml`, or run `mongod --replSet rs0` and initiate it yourself, for local testing.
