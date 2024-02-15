export default () => ({
  email: {
    domain: process.env.MAILGUN_DOMAIN,
    key: process.env.MAILGUN_API_KEY,
    host: process.env.MAILGUN_HOST,
  },
});
