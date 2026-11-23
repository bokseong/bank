import { describe, expect, it } from "vitest";
import { detectInstallEnvironment } from "./install";

function makeWindow({ userAgent = "", standalone = false, iosStandalone = false, bridge = false } = {}) {
  return {
    navigator: { userAgent, standalone: iosStandalone, maxTouchPoints: 0 },
    matchMedia: () => ({ matches: standalone }),
    BokseongBank: bridge ? { postMessage() {} } : undefined,
  };
}

describe("detectInstallEnvironment", () => {
  it("hides downloads in an installed PWA", () => {
    expect(detectInstallEnvironment(makeWindow({ standalone: true })).hideDownloads).toBe(true);
  });

  it("hides downloads in an iOS home-screen web app", () => {
    expect(detectInstallEnvironment(makeWindow({ iosStandalone: true })).hideDownloads).toBe(true);
  });

  it("hides downloads in the native bank app bridge", () => {
    expect(detectInstallEnvironment(makeWindow({ bridge: true })).hideDownloads).toBe(true);
  });

  it("hides downloads in an Android WebView", () => {
    const userAgent = "Mozilla/5.0 (Linux; Android 15; Pixel 8 Build/AP3A; wv) AppleWebKit/537.36 Version/4.0 Chrome/130.0 Mobile Safari/537.36";
    expect(detectInstallEnvironment(makeWindow({ userAgent })).hideDownloads).toBe(true);
  });

  it("keeps downloads visible in regular Android Chrome", () => {
    const userAgent = "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36";
    const result = detectInstallEnvironment(makeWindow({ userAgent }));
    expect(result.android).toBe(true);
    expect(result.hideDownloads).toBe(false);
  });
});
