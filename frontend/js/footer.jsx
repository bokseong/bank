const base = import.meta.env.BASE_URL;

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <p>© 2026. 순천 복성고 학생회 &amp; 축제 준비 위원회 | All rights reserved.</p>
      <p>
        Designed by{" "}
        <a
          className="designer-link"
          href="https://github.com/jw-astro09/"
          target="_blank"
          rel="noreferrer"
        >
          jw-astro09
        </a>
      </p>
      <div className="recaptcha-protection" aria-label="reCAPTCHA 및 Google Cloud Fraud Defense 보호 사용 중">
        <img src="https://www.gstatic.com/recaptcha/api2/logo_48.png" alt="reCAPTCHA" width="34" height="34" />
        <span>
          <b>reCAPTCHA</b>
          <small>Google Cloud Fraud Defense로 보호됩니다</small>
        </span>
      </div>
      <p className="recaptcha-legal">
        이 사이트는 reCAPTCHA로 보호되며 Google의{" "}
        <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">
          개인정보처리방침
        </a>{" "}
        및{" "}
        <a href="https://policies.google.com/terms" target="_blank" rel="noreferrer">
          서비스 약관
        </a>
        이 적용됩니다.
      </p>
      <a className="about-button" href={`${base}about.html`}>
        이 사이트에 대해 알아보기
      </a>
    </footer>
  );
}
