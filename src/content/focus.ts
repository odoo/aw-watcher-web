import browser from 'webextension-polyfill'

window.addEventListener('focus', () => {
  browser.runtime.sendMessage({ type: 'AW_FOCUS_CHANGED', focused: true }).catch(() => {})
})

window.addEventListener('blur', () => {
  browser.runtime.sendMessage({ type: 'AW_FOCUS_CHANGED', focused: false }).catch(() => {})
})
