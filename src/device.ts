// Which browser, on which system, read from the user-agent string: a page is never told
// the device's own name. Backup file names carry it, so backups from different devices
// can be told apart. The same rules as the RDR2 Crafting Guide's device.js.
//
// Edge, Opera and Samsung's browser all claim to be Chrome as well, so they are asked
// first; Chrome claims to be Safari, so Safari is asked last.

export interface Device {
  browser: string | null;
  system: string | null;
}

export function detectDevice(ua = navigator.userAgent, touchPoints = navigator.maxTouchPoints ?? 0): Device {
  const browser = /Edg(e|A|iOS)?\//.test(ua) ? "Edge"
    : /OPR\/|Opera/.test(ua) ? "Opera"
    : /SamsungBrowser/.test(ua) ? "Samsung Internet"
    : /Firefox\/|FxiOS/.test(ua) ? "Firefox"
    : /Chrome\/|CriOS/.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari"
    : null;
  // An iPad asks for the desktop site and says it is a Mac; a touch screen gives it away.
  const system = /iPhone/.test(ua) ? "iPhone"
    : /iPad/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1) ? "iPad"
    : /Android/.test(ua) ? "Android"
    : /CrOS/.test(ua) ? "ChromeOS"
    : /Windows/.test(ua) ? "Windows"
    : /Macintosh/.test(ua) ? "Mac"
    : /Linux/.test(ua) ? "Linux"
    : null;
  return { browser, system };
}
