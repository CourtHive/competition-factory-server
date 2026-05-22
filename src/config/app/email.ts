/**
 * Transactional email configuration.
 *
 * `from` is the RFC 5322 mailbox the EmailService passes to the
 * adapter on every send — must match a verified sending domain at the
 * provider. Example: `CourtHive <no-reply@send.courthive.com>`.
 *
 * Vendor-specific keys (currently RESEND_API_KEY) are read by the
 * adapter from process.env directly; this config object holds only the
 * vendor-agnostic values.
 */
export default () => ({
  email: {
    from: process.env.EMAIL_FROM,
  },
});
