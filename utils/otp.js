const crypto = require("crypto");
const dns = require("dns").promises;
const nodemailer = require("nodemailer");
const bcrypt = require("bcrypt");

const OTP_LENGTH = 6;
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const OTP_RESEND_COOLDOWN_MS = 60 * 1000; // 1 minute between resends

// ---------- EMAIL FORMAT / DOMAIN VALIDATION ----------

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

/**
 * Validates an email address is well-formed, optionally restricted to one
 * domain (set ALLOWED_EMAIL_DOMAIN=gmail.com in .env to only accept Gmail
 * addresses - common ask for a college election so every voter uses their
 * personal Gmail rather than a throwaway address), and that its domain
 * actually has mail servers configured (catches typos like "gmial.com").
 *
 * Returns { valid: boolean, reason?: string }
 */
async function validateEmail(rawEmail) {
    const email = String(rawEmail || "").trim().toLowerCase();

    if (!EMAIL_REGEX.test(email)) {
        return { valid: false, reason: "That doesn't look like a valid email address." };
    }

    const domain = email.split("@")[1];
    const allowedDomain = (process.env.ALLOWED_EMAIL_DOMAIN || "").trim().toLowerCase();
    if (allowedDomain && domain !== allowedDomain) {
        return { valid: false, reason: `Please sign up with a @${allowedDomain} email address.` };
    }

    // MX lookup confirms the domain can actually receive mail. Fails open
    // (treats as valid) if DNS itself is unreachable, so a flaky network
    // doesn't block every signup - the OTP step is the real verification.
    try {
        const records = await dns.resolveMx(domain);
        if (!records || records.length === 0) {
            return { valid: false, reason: "That email domain doesn't appear to accept mail. Double check for typos." };
        }
    } catch (err) {
        if (err.code === "ENOTFOUND" || err.code === "ENODATA") {
            return { valid: false, reason: "That email domain doesn't appear to accept mail. Double check for typos." };
        }
        // other DNS errors (e.g. network unavailable) - don't block signup
    }

    return { valid: true };
}

// ---------- OTP GENERATION / VERIFICATION ----------

function generateOtp() {
    // 6-digit numeric code, zero-padded
    const n = crypto.randomInt(0, 10 ** OTP_LENGTH);
    return String(n).padStart(OTP_LENGTH, "0");
}

/** Sets a fresh OTP on a user document (does not save). Returns the plaintext code to email. */
async function assignOtp(user) {
    const code = generateOtp();
    user.otpHash = await bcrypt.hash(code, 10);
    user.otpExpires = new Date(Date.now() + OTP_TTL_MS);
    user.otpAttempts = 0;
    user.otpLastSentAt = new Date();
    return code;
}

/** Returns null if allowed to resend, or the number of seconds to wait. */
function resendCooldownRemaining(user) {
    if (!user.otpLastSentAt) return 0;
    const elapsed = Date.now() - user.otpLastSentAt.getTime();
    const remaining = Math.ceil((OTP_RESEND_COOLDOWN_MS - elapsed) / 1000);
    return remaining > 0 ? remaining : 0;
}

const MAX_OTP_ATTEMPTS = 5;

/**
 * Checks a submitted OTP against the user's stored hash.
 * Returns { ok: boolean, reason?: string }
 */
async function checkOtp(user, submitted) {
    if (!user.otpHash || !user.otpExpires) {
        return { ok: false, reason: "No verification code is pending. Request a new one." };
    }
    if (user.otpExpires < new Date()) {
        return { ok: false, reason: "That code has expired. Request a new one." };
    }
    if (user.otpAttempts >= MAX_OTP_ATTEMPTS) {
        return { ok: false, reason: "Too many incorrect attempts. Request a new code." };
    }

    const matches = await bcrypt.compare(String(submitted || ""), user.otpHash);
    if (!matches) {
        user.otpAttempts += 1;
        return { ok: false, reason: "Incorrect code. Please try again." };
    }

    return { ok: true };
}

// ---------- MAILER ----------

let cachedTransporter = null;

function getTransporter() {
    if (cachedTransporter) return cachedTransporter;

    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
        return null; // not configured - caller falls back to logging the code
    }

    cachedTransporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT) || 587,
        secure: Number(process.env.SMTP_PORT) === 465,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        },
    });
    return cachedTransporter;
}

/**
 * Sends the OTP email. If SMTP isn't configured (e.g. local dev without
 * mail credentials set up yet), logs the code to the console instead so the
 * whole signup flow is still testable without real email.
 */
async function sendOtpEmail(toEmail, code) {
    const transporter = getTransporter();
    const appName = process.env.APP_NAME || "Student Voting System";

    if (!transporter) {
        console.log(`\n[DEV MODE - no SMTP configured] Verification code for ${toEmail}: ${code}\n`);
        return;
    }

    await transporter.sendMail({
        from: process.env.MAIL_FROM || process.env.SMTP_USER,
        to: toEmail,
        subject: `${appName}: your verification code is ${code}`,
        text: `Your verification code is ${code}. It expires in 10 minutes. If you didn't request this, you can ignore this email.`,
        html: `<p>Your verification code is:</p><p style="font-size:28px;font-weight:bold;letter-spacing:4px;">${code}</p><p>It expires in 10 minutes. If you didn't request this, you can ignore this email.</p>`,
    });
}

module.exports = {
    validateEmail,
    assignOtp,
    checkOtp,
    resendCooldownRemaining,
    sendOtpEmail,
};
