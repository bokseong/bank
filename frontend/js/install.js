export function detectInstallEnvironment(browserWindow = window) {
  const navigatorInfo = browserWindow.navigator || {};
  const userAgent = navigatorInfo.userAgent || "";
  const standalone = Boolean(
    browserWindow.matchMedia?.("(display-mode: standalone)")?.matches ||
      navigatorInfo.standalone === true,
  );
  const nativeBridge =
    typeof browserWindow.BokseongBank?.postMessage === "function";
  const androidWebView =
    /;\s*wv\)/i.test(userAgent) ||
    /\bVersion\/4\.0\b.*\bChrome\/.*\bMobile Safari\b/i.test(userAgent);

  return {
    standalone,
    nativeApp: nativeBridge || androidWebView,
    android: /Android/i.test(userAgent),
    ios:
      /iPad|iPhone|iPod/i.test(userAgent) ||
      (/Macintosh/i.test(userAgent) && Number(navigatorInfo.maxTouchPoints) > 1),
    hideDownloads: standalone || nativeBridge || androidWebView,
  };
}
