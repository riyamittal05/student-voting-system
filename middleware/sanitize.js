// Lightweight NoSQL-injection guard.
// Strips any object keys that start with "$" or contain "." from
// req.body / req.query / req.params so query operators like
// { "email[$gt]": "" } can never reach a Mongoose query.
function stripBadKeys(obj) {
    if (obj === null || typeof obj !== "object") return obj;

    if (Array.isArray(obj)) {
        return obj.map(stripBadKeys);
    }

    const clean = {};
    for (const key of Object.keys(obj)) {
        if (key.startsWith("$") || key.includes(".")) {
            continue; // drop dangerous keys
        }
        clean[key] = stripBadKeys(obj[key]);
    }
    return clean;
}

module.exports = function mongoSanitize(req, res, next) {
    if (req.body) req.body = stripBadKeys(req.body);
    if (req.query) req.query = stripBadKeys(req.query);
    if (req.params) req.params = stripBadKeys(req.params);
    next();
};