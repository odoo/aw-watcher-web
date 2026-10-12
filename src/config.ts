const config = {
  isDevelopment: import.meta.env.DEV,
  requireConsent: import.meta.env.VITE_TARGET_BROWSER === 'firefox',
  heartbeat: {
    alarmName: 'heartbeat',
    intervalInSeconds: 60,
    // Composing (subject, recipients) or opening an inline reply doesn't change the URL,
    // so we check the Gmail data regularly to catch it
    gmailCheckIntervalInSeconds: 5,
  },
}

export default config
