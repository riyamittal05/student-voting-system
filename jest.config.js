module.exports = {
    testEnvironment: "node",
    testPathIgnorePatterns: ["/node_modules/", "/uploads/"],
    collectCoverageFrom: ["utils/**/*.js", "models/**/*.js", "!**/node_modules/**"],
};
