const crypto = require("crypto");

// Simple session-based CSRF protection (no extra dependency needed).
// 1. A token is generated once per session and exposed to every view as csrfToken.
// 2. Every state-changing form must echo that token back as hidden field "_csrf".
// 3. On POST/PUT/DELETE we compare the submitted token with the one in session.
function attachToken(req, res, next) {
    if (!req.session.csrfToken) {
        req.session.csrfToken = crypto.randomBytes(24).toString("hex");
    }
    res.locals.csrfToken = req.session.csrfToken;
    next();
}

function verifyToken(req, res, next) {
    const submitted = req.body && req.body._csrf;
    if (!submitted || submitted !== req.session.csrfToken) {
        req.flash("error", "Your session expired or the form was resubmitted. Please try again.");
        const fallback = req.get("Referrer") || "/";
        return res.redirect(fallback);
    }
    next();
}

module.exports = { attachToken, verifyToken };