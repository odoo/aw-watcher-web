const config = {
  isDevelopment: import.meta.env.DEV,
  requireConsent: import.meta.env.VITE_TARGET_BROWSER === 'firefox',
  heartbeat: {
    alarmName: 'heartbeat',
    intervalInSeconds: 60,
    // Composing (subject, recipients) or opening an inline reply doesn't change the URL,
    // so we check the webmail data regularly to catch it
    mailCheckIntervalInSeconds: 5,
  },
}

export default config
