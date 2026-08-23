jest.mock("dns", () => ({
    promises: {
        resolveMx: jest.fn(),
    },
}));

const dns = require("dns");
const { validateEmail, assignOtp, checkOtp, resendCooldownRemaining } = require("../utils/otp");

describe("validateEmail", () => {
    beforeEach(() => {
        jest.resetAllMocks();
        delete process.env.ALLOWED_EMAIL_DOMAIN;
    });

    test("rejects malformed addresses before ever hitting DNS", async () => {
        const result = await validateEmail("not-an-email");
        expect(result.valid).toBe(false);
        expect(dns.promises.resolveMx).not.toHaveBeenCalled();
    });

    test("rejects addresses missing a domain", async () => {
        const result = await validateEmail("someone@");
        expect(result.valid).toBe(false);
    });

    test("accepts a well-formed address with valid MX records", async () => {
        dns.promises.resolveMx.mockResolvedValue([{ exchange: "gmail-smtp-in.l.google.com", priority: 5 }]);
        const result = await validateEmail("student@gmail.com");
        expect(result.valid).toBe(true);
    });

    test("rejects a domain with no MX records", async () => {
        dns.promises.resolveMx.mockResolvedValue([]);
        const result = await validateEmail("student@example.com");
        expect(result.valid).toBe(false);
    });

    test("rejects a domain that doesn't exist (ENOTFOUND)", async () => {
        dns.promises.resolveMx.mockRejectedValue(Object.assign(new Error("not found"), { code: "ENOTFOUND" }));
        const result = await validateEmail("student@gmial-typo.com");
        expect(result.valid).toBe(false);
    });

    test("fails open (accepts) when DNS itself is unreachable, not the domain's fault", async () => {
        dns.promises.resolveMx.mockRejectedValue(Object.assign(new Error("network down"), { code: "ETIMEDOUT" }));
        const result = await validateEmail("student@gmail.com");
        expect(result.valid).toBe(true);
    });

    test("enforces ALLOWED_EMAIL_DOMAIN when set", async () => {
        process.env.ALLOWED_EMAIL_DOMAIN = "gmail.com";
        dns.promises.resolveMx.mockResolvedValue([{ exchange: "mx", priority: 5 }]);

        const wrongDomain = await validateEmail("student@yahoo.com");
        expect(wrongDomain.valid).toBe(false);

        const rightDomain = await validateEmail("student@gmail.com");
        expect(rightDomain.valid).toBe(true);
    });
});

describe("OTP assign/check", () => {
    test("assignOtp sets a hash, expiry, and returns the plaintext code", async () => {
        const user = {};
        const code = await assignOtp(user);
        expect(code).toMatch(/^\d{6}$/);
        expect(user.otpHash).toBeTruthy();
        expect(user.otpHash).not.toBe(code); // stored hashed, not plaintext
        expect(user.otpExpires.getTime()).toBeGreaterThan(Date.now());
        expect(user.otpAttempts).toBe(0);
    });

    test("checkOtp succeeds with the correct code", async () => {
        const user = {};
        const code = await assignOtp(user);
        const result = await checkOtp(user, code);
        expect(result.ok).toBe(true);
    });

    test("checkOtp fails with an incorrect code and increments attempts", async () => {
        const user = {};
        await assignOtp(user);
        const result = await checkOtp(user, "000000");
        expect(result.ok).toBe(false);
        expect(user.otpAttempts).toBe(1);
    });

    test("checkOtp fails once expired", async () => {
        const user = {};
        const code = await assignOtp(user);
        user.otpExpires = new Date(Date.now() - 1000); // force expiry
        const result = await checkOtp(user, code);
        expect(result.ok).toBe(false);
        expect(result.reason).toMatch(/expired/i);
    });

    test("checkOtp locks out after too many wrong attempts", async () => {
        const user = {};
        await assignOtp(user);
        for (let i = 0; i < 5; i++) {
            await checkOtp(user, "wrong");
        }
        const result = await checkOtp(user, "wrong");
        expect(result.ok).toBe(false);
        expect(result.reason).toMatch(/too many/i);
    });

    test("resendCooldownRemaining is 0 right after a fresh assignment window elapses", () => {
        const user = { otpLastSentAt: new Date(Date.now() - 120 * 1000) };
        expect(resendCooldownRemaining(user)).toBe(0);
    });

    test("resendCooldownRemaining is > 0 immediately after sending", () => {
        const user = { otpLastSentAt: new Date() };
        expect(resendCooldownRemaining(user)).toBeGreaterThan(0);
    });
});
