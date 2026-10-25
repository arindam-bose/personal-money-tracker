import { describe, expect, it } from "vitest";
import { backupFileName } from "../src/backup";
import { detectDevice } from "../src/device";

const UA = {
  chromeLinux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  edgeWindows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
  firefoxAndroid: "Mozilla/5.0 (Android 15; Mobile; rv:144.0) Gecko/144.0 Firefox/144.0",
  samsungAndroid: "Mozilla/5.0 (Linux; Android 15; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36",
  safariIphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
  chromeIphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1",
  safariMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15",
};

describe("detectDevice", () => {
  it("names the browser and system, asking look-alikes first", () => {
    expect(detectDevice(UA.chromeLinux, 0)).toEqual({ browser: "Chrome", system: "Linux" });
    expect(detectDevice(UA.edgeWindows, 0)).toEqual({ browser: "Edge", system: "Windows" });
    expect(detectDevice(UA.firefoxAndroid, 5)).toEqual({ browser: "Firefox", system: "Android" });
    expect(detectDevice(UA.samsungAndroid, 5)).toEqual({ browser: "Samsung Internet", system: "Android" });
    expect(detectDevice(UA.safariIphone, 5)).toEqual({ browser: "Safari", system: "iPhone" });
    expect(detectDevice(UA.chromeIphone, 5)).toEqual({ browser: "Chrome", system: "iPhone" });
    expect(detectDevice(UA.safariMac, 0)).toEqual({ browser: "Safari", system: "Mac" });
  });

  it("tells an iPad from a Mac by its touch screen", () => {
    expect(detectDevice(UA.safariMac, 5)).toEqual({ browser: "Safari", system: "iPad" });
  });

  it("gives null for what it can't make out", () => {
    expect(detectDevice("curl/8.5.0", 0)).toEqual({ browser: null, system: null });
  });
});

describe("backupFileName", () => {
  // Local time, so the name shows the reader's own clock.
  const at = new Date(2026, 9, 25, 21, 5, 9);

  it("is year, date, time, browser and system", () => {
    expect(backupFileName(2026, at, { browser: "Chrome", system: "Linux" }))
      .toBe("money-tracker-2026_2026-10-25_21-05-09_chrome_linux.json");
    expect(backupFileName(2025, at, { browser: "Samsung Internet", system: "Android" }))
      .toBe("money-tracker-2025_2026-10-25_21-05-09_samsung-internet_android.json");
  });

  it("leaves out what the device didn't say", () => {
    expect(backupFileName(2026, at, { browser: null, system: "Linux" })).toBe("money-tracker-2026_2026-10-25_21-05-09_linux.json");
    expect(backupFileName(2026, at, { browser: null, system: null })).toBe("money-tracker-2026_2026-10-25_21-05-09.json");
  });
});
