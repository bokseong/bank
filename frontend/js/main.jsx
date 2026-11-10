import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  createUserWithEmailAndPassword,
  deleteUser,
  EmailAuthProvider,
  GithubAuthProvider,
  GoogleAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { push, ref, serverTimestamp as rtdbServerTimestamp } from "firebase/database";
import { httpsCallable } from "firebase/functions";
import { BrowserQRCodeReader } from "@zxing/browser";
import {
  Banknote,
  Building2,
  Camera,
  History,
  LogOut,
  QrCode,
  RefreshCw,
  Settings,
  ShieldCheck,
  UserRound,
  WalletCards,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { auth, db, functions, rtdb } from "./firebase";
import { friendlyError, validAmount, won } from "./domain";
import { makeOrderQr, parseOrderQr } from "./qr";
import "../css/style.css";

const roles = {
    member: "일반회원",
    shop: "상점",
    admin1: "1급 관리자",
    admin2: "2급 관리자",
  },
  types = { payment: "결제", topup: "충전", refund: "환불", cancellation: "결제 취소", adjustment: "포인트 조절" },
  legacyRoles = { student: "member", booth: "shop", admin: "admin1" };
const base = import.meta.env.BASE_URL;
const googleProvider = new GoogleAuthProvider(),
  githubProvider = new GithubAuthProvider();
const ROOT_ADMIN_EMAIL = "github.jwastro09@gmail.com";
const THEME_STORAGE_KEY = "bokseong-festival-bank-theme";
const isRootAdmin = (user) =>
  user?.emailVerified && user.email?.toLowerCase() === ROOT_ADMIN_EMAIL;
const normalizeRole = (role) => legacyRoles[role] || role || "member";
const isAdmin1 = (profile) => profile?.role === "admin1";
const isAdmin2 = (profile) => profile?.role === "admin2" || isAdmin1(profile);
const defaultConfig = {
  festivalName: "복성고 축제은행",
  announcement: "",
  systemOpen: true,
  paymentsEnabled: true,
  topupEnabled: true,
  refundEnabled: true,
  forcePaymentPassword: true,
  minPayment: 1,
  maxPayment: 1000000,
  maxTopupAmount: 50000,
  autoTopupEnabled: false,
  bankAccountLabel: "학생회 운영 계좌",
  bankAccountNumber: "",
  qrExpirySeconds: 180,
};
async function writeOperationalLog(event, detail = "") {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  try { await push(ref(rtdb, `operationalLogs/${uid}`), { event: String(event).slice(0, 40), detail: String(detail).slice(0, 160), at: rtdbServerTimestamp() }); } catch { /* 로그 실패는 결제 흐름을 중단하지 않습니다. */ }
}
function useDarkMode() {
  const [darkMode, setDarkMode] = useState(
    () => localStorage.getItem(THEME_STORAGE_KEY) === "dark",
  );
  useEffect(() => {
    document.documentElement.classList.toggle("dark-theme", darkMode);
    localStorage.setItem(THEME_STORAGE_KEY, darkMode ? "dark" : "light");
  }, [darkMode]);
  return [darkMode, setDarkMode];
}
function requestProfileDetails() {
  alert("처음 로그인한 계정입니다. 이름과 학번을 입력해 계정 정보를 생성해 주세요.");
  while (true) {
    const name = window.prompt("이름을 입력하세요.");
    if (name === null) return null;
    const studentId = window.prompt("학번을 숫자로 입력하세요.");
    if (studentId === null) return null;
    const cleanName = name.trim();
    const cleanStudentId = studentId.replace(/\D/g, "");
    if (cleanName && cleanName.length <= 20 && cleanStudentId && cleanStudentId.length <= 10)
      return { name: cleanName, studentId: cleanStudentId };
    alert("이름(1~20자)과 학번(숫자 1~10자리)을 확인해 주세요.");
  }
}
function useSession() {
  const [s, setS] = useState({
    loading: true,
    user: null,
    profile: null,
    config: defaultConfig,
    error: "",
  });
  const provisioningRef = useRef(false);
  useEffect(
    () =>
      onAuthStateChanged(auth, async (user) => {
        try {
          if (!user)
            return setS((x) => ({
              ...x,
              loading: false,
              user: null,
              profile: null,
              error: "",
            }));
          const ref = doc(db, "users", user.uid);
          let p = await getDoc(ref);
          if (!p.exists() && isRootAdmin(user)) {
            await setDoc(ref, {
              name: user.displayName || "최상위 관리자",
              studentId: "ADMIN",
              role: "admin1",
              status: "active",
              balance: 0,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
            p = await getDoc(ref);
          }
          if (!p.exists() && !isRootAdmin(user)) {
            if (provisioningRef.current) return;
            provisioningRef.current = true;
            const details = requestProfileDetails();
            if (!details) {
              alert("이름과 학번을 입력하지 않아 로그아웃되었습니다.");
              await signOut(auth);
              return;
            }
            await setDoc(ref, {
              ...details,
              role: "member",
              status: "active",
              balance: 0,
              requirePaymentPassword: true,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
            p = await getDoc(ref);
            provisioningRef.current = false;
          }
          setS((x) => ({
            ...x,
            loading: false,
            user,
            error: "",
            profile: p.exists()
              ? {
                  id: p.id,
                  ...p.data(),
                  role: isRootAdmin(user) ? "admin1" : normalizeRole(p.data().role),
                }
              : null,
          }));
        } catch (error) {
          console.error("세션 초기화 실패", error);
          setS((x) => ({
            ...x,
            loading: false,
            user,
            profile: null,
            error: friendlyError(error),
          }));
        }
      }),
    [],
  );
  useEffect(() => {
    if (!s.user) return;
    const a = onSnapshot(
      doc(db, "users", s.user.uid),
      (p) =>
        p.exists() &&
        setS((x) => ({
          ...x,
          profile: {
            id: p.id,
            ...p.data(),
            role: isRootAdmin(s.user) ? "admin1" : normalizeRole(p.data().role),
          },
        })),
    );
    const b = onSnapshot(doc(db, "settings", "config"), (c) =>
      setS((x) => ({
        ...x,
        config: c.exists() ? { ...defaultConfig, ...c.data() } : defaultConfig,
      })),
    );
    return () => {
      a();
      b();
    };
  }, [s.user]);
  return s;
}
function ProviderButtons({ busy, onProvider, mode }) {
  return (
    <>
      <div className="divider">
        <span>또는</span>
      </div>
      <div className="provider-buttons">
        <button
          type="button"
          className="provider google"
          disabled={busy}
          onClick={() => onProvider(googleProvider)}
        >
          <b>G</b>Google로 {mode}
        </button>
        <button
          type="button"
          className="provider github"
          disabled={busy}
          onClick={() => onProvider(githubProvider)}
        >
          <b>●</b>GitHub로 {mode}
        </button>
      </div>
    </>
  );
}
function Auth() {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }
  async function oauth(provider) {
    setBusy(true);
    setError("");
    try {
      await signInWithPopup(auth, provider);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth">
      <section className="hero">
        <div className="mark">
          <Building2 />
          복성고 축제은행
        </div>
        <h1>
          현금 없이 더<br />
          가볍게 즐기는 축제
        </h1>
        <p>안전하게 결제하고 실시간으로 잔액을 확인하세요.</p>
        <div className="hero-points">
          <span>
            <ShieldCheck />
            거래 기록 보호
          </span>
          <span>
            <WalletCards />
            실시간 잔액 확인
          </span>
        </div>
      </section>
      <section className="auth-card">
        <h2>로그인</h2>
        <p>축제은행 계정으로 로그인하세요.</p>
        <form onSubmit={submit}>
          <label>
            이메일
            <input
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            비밀번호
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && <div className="error">{error}</div>}
          <button disabled={busy}>
            {busy ? "확인 중…" : "이메일로 로그인"}
          </button>
        </form>
        <ProviderButtons busy={busy} onProvider={oauth} mode="로그인" />
        <small className="auth-help">
          계정 발급 또는 비밀번호 재설정이 필요하면 축제은행 관리자에게 문의하세요.
        </small>
      </section>
    </main>
  );
}
function LegalModal({ type, onClose }) {
  const [html, setHtml] = useState("");
  useEffect(() => {
    const template = document.getElementById(`${type}-content`);
    setHtml(template?.innerHTML || "<p>본문을 입력해 주세요.</p>");
  }, [type]);
  return (
    <div className="legal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="legal-modal"
        role="dialog"
        aria-modal="true"
        aria-label={type === "terms" ? "이용약관" : "개인정보 수집 안내"}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="legal-body" dangerouslySetInnerHTML={{ __html: html }} />
        <button type="button" onClick={onClose}>
          확인
        </button>
      </section>
    </div>
  );
}
function SiteFooter() {
  return (
    <footer className="site-footer">
      <p>© Suncheon Bokseong High School | All rights reserved.</p>
      <p>
        Designed by{" "}
        <a href="https://github.com/jw-astro09" target="_blank" rel="noreferrer">
          jw-astro09
        </a>
        {/* ,
        <a href="https://github.com/kimdduramy" target="_blank" rel="noreferrer">
        kimdduramy
        </a> */}
      </p>
      <div className="recaptcha-protection" aria-label="reCAPTCHA 및 Google Cloud Fraud Defense 보호 사용 중">
        <img src="https://www.gstatic.com/recaptcha/api2/logo_48.png" alt="reCAPTCHA" width="34" height="34" />
        <span><b>reCAPTCHA</b><small>Google Cloud Fraud Defense로 보호됩니다</small></span>
      </div>
      <p className="recaptcha-legal">
        이 사이트는 reCAPTCHA로 보호되며 Google의{" "}
        <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">개인정보처리방침</a> 및{" "}
        <a href="https://policies.google.com/terms" target="_blank" rel="noreferrer">서비스 약관</a>이 적용됩니다.
      </p>
      <a className="about-button" href={`${base}about.html`}>
        이 사이트에 대해 알아보기
      </a>
    </footer>
  );
}
function About() {
  const legal = {
    terms: document.getElementById("terms-content")?.innerHTML || "",
    privacy: document.getElementById("privacy-content")?.innerHTML || "",
  };
  const contacts = document.getElementById("site-contact-content")?.innerHTML || "";
  return (
    <main className="about-page">
      <header className="about-header">
        <a className="brand" href={base}><Building2 />복성고 축제은행</a>
        <a className="back-link" href={base}>메인 화면으로 돌아가기</a>
      </header>
      <div className="about-content">
        <section className="about-intro">
          <span>ABOUT THE SERVICE</span>
          <h1>사이트 정보</h1>
          <p>학교 축제에서 현금과 잔돈 사용을 줄이고, 교내 포인트로 충전·결제·정산을 관리하기 위한 서비스입니다.</p>
        </section>
        <section className="info-card">
          <h2>운영 담당 및 환전소</h2>
          <div dangerouslySetInnerHTML={{ __html: contacts }} />
        </section>
        <section className="legal-grid" aria-live="polite">
          <article className="info-card legal-body" dangerouslySetInnerHTML={{ __html: legal.terms || "<p>이용약관을 불러오는 중입니다…</p>" }} />
          <article className="info-card legal-body" dangerouslySetInnerHTML={{ __html: legal.privacy || "<p>개인정보 수집 안내를 불러오는 중입니다…</p>" }} />
        </section>
        <p className="sync-note"> </p>
      </div>
    </main>
  );
}
function HomeDashboard({ profile, config }) {
  const destinations = isAdmin1(profile)
    ? [{ href: "admin.html", icon: ShieldCheck, title: "관리자 페이지", description: "계정 권한, 가입 승인과 운영 설정을 관리합니다." }, { href: "points.html", icon: Banknote, title: "포인트 충전", description: "모든 등급의 계정에 포인트를 충전합니다." }, { href: "history.html", icon: History, title: "결제 페이지", description: "전체 결제 기록을 조회합니다." }, { href: "settings.html", icon: UserRound, title: "내 정보 조회", description: "내 계정 정보를 확인합니다." }]
    : profile.role === "admin2"
      ? [{ href: "points.html", icon: Banknote, title: "포인트 조절", description: "현금 수납 확인 후 포인트를 충전하고 환불을 검토합니다." }, { href: "history.html", icon: History, title: "거래 내역", description: "포인트 조절과 결제 기록을 조회합니다." }, { href: "settings.html", icon: UserRound, title: "내 정보 조회", description: "내 계정 정보를 확인합니다." }]
      : profile.role === "shop"
        ? [{ href: "booth.html", icon: QrCode, title: "상점 관리", description: "상품·가격을 등록하고 주문 QR을 만듭니다." }, { href: "history.html", icon: History, title: "결제 페이지", description: "상점 거래 기록을 조회합니다." }, { href: "settings.html", icon: UserRound, title: "내 정보 조회", description: "내 계정 정보를 확인합니다." }]
        : [{ href: "payment.html", icon: QrCode, title: "QR 결제", description: "상점의 임시 주문 QR을 스캔합니다." }, { href: "history.html", icon: History, title: "결제 페이지", description: "내 결제 기록을 조회합니다." }, { href: "settings.html", icon: UserRound, title: "내 정보 조회", description: "내 계정 정보를 확인합니다." }];
  return (
    <>
      <section className="home-welcome">
        <span>FESTIVAL BANK</span>
        <h1>{profile.name}님, 환영합니다.</h1>
        <p>{config.announcement || "필요한 메뉴를 선택해 축제은행을 이용하세요."}</p>
      </section>
      <section className="home-links" aria-label="주요 메뉴">
        {destinations.map(({ href, icon: Icon, title, description }) => (
          <a className="home-link-card" href={`${base}${href}`} key={href}>
            <span className="home-link-icon"><Icon /></span>
            <strong>{title}</strong>
            <p>{description}</p>
            <span className="home-link-action">이동하기 →</span>
          </a>
        ))}
      </section>
    </>
  );
}
function Signup() {
  const [form, setForm] = useState({
      name: "",
      studentId: "",
      email: "",
      password: "",
      confirm: "",
      termsAccepted: false,
      privacyAccepted: false,
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [legal, setLegal] = useState(null);
  const profileData = () => ({
    name: form.name.trim(),
    studentId: form.studentId.trim(),
    role: "member",
    status: "active",
    balance: 0,
    requirePaymentPassword: true,
    termsAcceptedAt: serverTimestamp(),
    privacyAcceptedAt: serverTimestamp(),
    termsVersion: "2026-11-08",
    privacyVersion: "2026-11-08",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  async function createProfile(user) {
    await setDoc(doc(db, "users", user.uid), profileData());
  }
  function validIdentity() {
    if (!form.name.trim() || !form.studentId.trim()) {
      setError("이름과 학번을 입력해 주세요.");
      return false;
    }
    if (!form.termsAccepted || !form.privacyAccepted) {
      setError("이용약관과 개인정보 수집·이용에 모두 동의해 주세요.");
      return false;
    }
    return true;
  }
  async function submit(e) {
    e.preventDefault();
    if (!validIdentity()) return;
    if (form.password !== form.confirm)
      return setError("비밀번호가 일치하지 않습니다.");
    setBusy(true);
    setError("");
    try {
      const c = await createUserWithEmailAndPassword(
        auth,
        form.email,
        form.password,
      );
      try {
        await createProfile(c.user);
      } catch (e) {
        await deleteUser(c.user);
        throw e;
      }
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }
  async function oauth(provider) {
    if (!validIdentity()) return;
    setBusy(true);
    setError("");
    try {
      const result = await signInWithPopup(auth, provider);
      const existing = await getDoc(doc(db, "users", result.user.uid));
      if (existing.exists()) {
        await signOut(auth);
        throw new Error(
          "이미 가입된 계정입니다. 로그인 페이지를 이용해 주세요.",
        );
      }
      await createProfile(result.user);
    } catch (e) {
      await signOut(auth).catch(() => {});
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth">
      <section className="hero">
        <div className="mark">
          <Building2 />
          복성고 축제은행
        </div>
        <h1>
          학생 계정
          <br />
          회원가입
        </h1>
        <p>
          가입을 완료하면 바로 축제은행 기능을 이용할 수 있습니다.
        </p>
      </section>
      <section className="auth-card signup-card">
        <h2>회원가입</h2>
        <p>본인의 정확한 정보를 입력하세요.</p>
        <label>
          이름
          <input
            required
            maxLength="20"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </label>
        <label>
          학번
          <input
            required
            maxLength="10"
            placeholder="예: 2901"
            value={form.studentId}
            onChange={(e) =>
              setForm({ ...form, studentId: e.target.value.replace(/\D/g, "") })
            }
          />
        </label>
        <div className="legal-consent">
          <label className="consent-row">
            <input
              type="checkbox"
              checked={form.termsAccepted}
              onChange={(e) =>
                setForm({ ...form, termsAccepted: e.target.checked })
              }
            />
            <span>
              <b>[필수]</b> 이용약관에 동의합니다.
              <button type="button" onClick={() => setLegal("terms")}>
                내용 보기
              </button>
            </span>
          </label>
          <label className="consent-row">
            <input
              type="checkbox"
              checked={form.privacyAccepted}
              onChange={(e) =>
                setForm({ ...form, privacyAccepted: e.target.checked })
              }
            />
            <span>
              <b>[필수]</b> 개인정보 수집·이용에 동의합니다.
              <button type="button" onClick={() => setLegal("privacy")}>
                내용 보기
              </button>
            </span>
          </label>
        </div>
        <form onSubmit={submit}>
          <label>
            이메일
            <input
              type="email"
              required
              autoComplete="username"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </label>
          <label>
            비밀번호
            <input
              type="password"
              required
              minLength="6"
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </label>
          <label>
            비밀번호 확인
            <input
              type="password"
              required
              minLength="6"
              autoComplete="new-password"
              value={form.confirm}
              onChange={(e) => setForm({ ...form, confirm: e.target.value })}
            />
          </label>
          {error && <div className="error">{error}</div>}
          <button disabled={busy}>
            {busy ? "가입 처리 중…" : "이메일로 가입"}
          </button>
        </form>
        <ProviderButtons busy={busy} onProvider={oauth} mode="회원가입" />
        <a className="auth-link" href={base}>
          로그인으로 돌아가기
        </a>
        {legal && <LegalModal type={legal} onClose={() => setLegal(null)} />}
      </section>
    </main>
  );
}
function HistoryList({ uid, admin = false, canPay = false, canCancel = false }) {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const q = admin
      ? query(
          collection(db, "transactions"),
          orderBy("createdAt", "desc"),
          limit(100),
        )
      : query(
          collection(db, "transactions"),
          where("participantUids", "array-contains", uid),
          orderBy("createdAt", "desc"),
          limit(30),
        );
    return onSnapshot(
      q,
      (s) => setItems(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => {},
    );
  }, [uid, admin]);
  async function requestCancellation(transactionId) {
    if (!window.confirm("이 결제를 취소 신청합니까? 1급 관리자의 승인 후 포인트가 되돌아갑니다.")) return;
    try {
      const payment = await getDoc(doc(db, "transactions", transactionId));
      if (!payment.exists() || payment.data().type !== "payment" || payment.data().boothUid !== uid) throw new Error("이 상점의 결제 기록만 취소 신청할 수 있습니다.");
      const data = payment.data();
      await addDoc(collection(db, "cancellationRequests"), { transactionId, shopUid: uid, shopName: data.boothName, payerUid: data.payerUid, amount: data.amount, memo: data.memo || "", status: "pending", createdAt: serverTimestamp() });
      window.alert("결제 취소 신청이 접수되었습니다.");
    } catch (e) { window.alert(friendlyError(e)); }
  }
  return (
    <section className="panel">
      <h2>결제 내역</h2>
      {canPay && <a className="pay-now" href={`${base}payment.html`}><QrCode /> 결제하기</a>}
      <div className="list">
        {!items.length && (
          <div className="empty">아직 결제 내역이 없습니다.</div>
        )}
        {items.map((x) => (
          <div className="row" key={x.id}>
            <div className={`icon ${x.type}`}>
              <Banknote />
            </div>
            <div>
              <b>{x.boothName || types[x.type] || x.type}</b>
              <small>
                {types[x.type]} ·{" "}
                {x.createdAt?.toDate?.().toLocaleString("ko-KR") || "처리 중"}
              </small>
            </div>
            <strong className={x.payerUid === uid ? "minus" : "plus"}>
              {x.payerUid === uid ? "-" : "+"}
              {won(x.amount)}
            </strong>
            {canCancel && x.type === "payment" && x.boothUid === uid && <button className="secondary" onClick={() => requestCancellation(x.id)}>결제 취소 신청</button>}
          </div>
        ))}
      </div>
    </section>
  );
}
function AccessDenied() {
  return <main className="pending"><ShieldCheck /><h1>접근 권한이 없습니다</h1><p>이 페이지는 현재 계정의 권한으로 이용할 수 없습니다.</p><a className="about-button" href={`${base}index.html`}>홈으로 돌아가기</a></main>;
}
function Scanner({ onRead, onClose }) {
  const video = useRef(null),
    controls = useRef(null),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    const reader = new BrowserQRCodeReader();
    reader
      .decodeFromConstraints(
        { video: { facingMode: { ideal: "environment" } } },
        video.current,
        (result, err, ctl) => {
          controls.current = ctl;
          if (result && live) {
            live = false;
            ctl.stop();
            try {
              onRead(parseOrderQr(result.getText()));
            } catch (e) {
              setError(e.message);
              live = true;
            }
          }
        },
      )
      .catch((e) =>
        setError(
          e.name === "NotAllowedError"
            ? "카메라 사용 권한이 필요합니다."
            : "카메라를 시작할 수 없습니다.",
        ),
      );
    return () => {
      live = false;
      controls.current?.stop();
    };
  }, [onRead]);
  return (
    <div className="scanner">
      <div className="scanner-head">
        <h3>결제 QR 스캔</h3>
        <button type="button" className="secondary" onClick={onClose}>
          닫기
        </button>
      </div>
      <video ref={video} muted playsInline />
      <div className="scan-frame" />
      <p>{error || "QR 코드가 사각형 안에 들어오게 비춰 주세요."}</p>
    </div>
  );
}
function Pay({ profile, config }) {
  const [invoice, setInvoice] = useState(null),
    [scanning, setScanning] = useState(false),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [msg, setMsg] = useState("");
  const needPassword =
    config.forcePaymentPassword || profile.requirePaymentPassword !== false;
  async function read(q) {
    setScanning(false);
    setBusy(true);
    try {
      const order = await getDoc(doc(db, "orders", q.orderId));
      if (!order.exists()) throw new Error("존재하지 않는 주문 QR입니다.");
      const data = order.data();
      if (data.shopUid !== q.shopId || data.status !== "pending")
        throw new Error("이미 사용되었거나 사용할 수 없는 주문 QR입니다.");
      if (data.expiresAt?.toMillis?.() <= Date.now())
        throw new Error("만료된 주문 QR입니다.");
      if (data.amount < config.minPayment || data.amount > config.maxPayment)
        throw new Error(`결제 가능 금액은 ${won(config.minPayment)}~${won(config.maxPayment)}입니다.`);
      setInvoice({ id: order.id, ...data });
      setMsg("");
    } catch (e) {
      setMsg(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }
  async function pay(e) {
    e.preventDefault();
    if (!invoice || !config.paymentsEnabled) return;
    if (invoice.amount > profile.balance) return setMsg("잔액이 부족합니다.");
    setBusy(true);
    setMsg("");
    try {
      if (needPassword) {
        if (!password) throw new Error("비밀번호를 입력해 주세요.");
        await reauthenticateWithCredential(
          auth.currentUser,
          EmailAuthProvider.credential(auth.currentUser.email, password),
        );
        await auth.currentUser.getIdToken(true);
      }
      const payerRef = doc(db, "users", profile.id), shopRef = doc(db, "users", invoice.shopUid), orderRef = doc(db, "orders", invoice.id);
      const [payer, shop, order] = await Promise.all([getDoc(payerRef), getDoc(shopRef), getDoc(orderRef)]);
      if (!payer.exists() || !shop.exists() || !order.exists() || order.data().status !== "pending") throw new Error("이미 처리되었거나 사용할 수 없는 주문입니다.");
      if (payer.data().balance < invoice.amount) throw new Error("잔액이 부족합니다.");
      const transactionRef = doc(collection(db, "transactions")), batch = writeBatch(db);
      batch.update(payerRef, { balance: payer.data().balance - invoice.amount, lastTransactionId: transactionRef.id, updatedAt: serverTimestamp() });
      batch.update(shopRef, { balance: shop.data().balance + invoice.amount, lastTransactionId: transactionRef.id, updatedAt: serverTimestamp() });
      batch.update(orderRef, { status: "paid", payerUid: profile.id, transactionId: transactionRef.id, paidAt: serverTimestamp() });
      batch.set(transactionRef, { type: "payment", payerUid: profile.id, boothUid: invoice.shopUid, boothName: invoice.shopName, amount: invoice.amount, memo: `${invoice.productName} ${invoice.quantity}개`.slice(0, 120), orderId: invoice.id, participantUids: [profile.id, invoice.shopUid], createdAt: serverTimestamp() });
      await batch.commit();
      void writeOperationalLog("payment_completed", `${invoice.id}:${invoice.amount}`);
      setInvoice(null);
      setPassword("");
      setMsg("결제가 완료되었습니다.");
    } catch (e) {
      setMsg(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel pay">
      <h2>QR 결제</h2>
      {!config.paymentsEnabled ? (
        <div className="error">현재 결제가 중지되어 있습니다.</div>
      ) : (
        <>
          {scanning ? (
            <Scanner onRead={read} onClose={() => setScanning(false)} />
          ) : !invoice ? (
            <div className="scan-start">
              <Camera />
              <h3>부스의 결제 QR을 스캔하세요</h3>
              <p>카메라 사용 권한을 허용해야 합니다.</p>
              <button onClick={() => setScanning(true)}>
                <QrCode /> QR 스캔 시작
              </button>
            </div>
          ) : (
            <form onSubmit={pay} className="invoice">
              <div className="invoice-title">
                <span>결제 상점</span>
                <strong>{invoice.shopName}</strong>
              </div>
              <div className="invoice-amount">
                <span>결제 금액</span>
                <strong>{won(invoice.amount)}</strong>
              </div>
              <p>상품: {invoice.productName} {invoice.quantity}개</p>
              {needPassword && (
                <label>
                  결제 비밀번호
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    placeholder="로그인 비밀번호"
                  />
                </label>
              )}
              <button disabled={busy}>
                {busy ? "결제 처리 중…" : `${won(invoice.amount)} 결제`}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => setInvoice(null)}
              >
                다시 스캔
              </button>
            </form>
          )}
        </>
      )}
      {msg && <p className="notice">{msg}</p>}
    </section>
  );
}
function Shop({ profile, config }) {
  const [products, setProducts] = useState([]),
    [selected, setSelected] = useState(null),
    [quantity, setQuantity] = useState(1),
    [form, setForm] = useState({ name: "", price: "" }),
    [order, setOrder] = useState(null),
    [msg, setMsg] = useState("");
  useEffect(
    () =>
      onSnapshot(
        query(collection(db, "shops", profile.id, "products"), orderBy("createdAt", "desc")),
        (s) => setProducts(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
        () => setMsg("상품 목록을 불러올 수 없습니다."),
      ),
    [profile.id],
  );
  const total = selected ? selected.price * quantity : 0;
  async function addProduct(e) {
    e.preventDefault();
    const price = validAmount(form.price, config.maxPayment);
    if (!form.name.trim() || !price) return setMsg("상품명과 올바른 가격을 입력하세요.");
    try {
      await addDoc(collection(db, "shops", profile.id, "products"), {
        name: form.name.trim().slice(0, 40),
        price,
        active: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setForm({ name: "", price: "" });
      setMsg("상품을 등록했습니다.");
    } catch (e) {
      setMsg(friendlyError(e));
    }
  }
  function selectProduct(product) {
    if (!product.active) return;
    setOrder(null);
    setSelected(product);
    setQuantity(1);
  }
  async function createOrder() {
    if (!selected || !config.paymentsEnabled) return;
    try {
      const orderRef = doc(collection(db, "orders"));
      const seconds = Math.min(Math.max(Number(config.qrExpirySeconds || 180), 60), 300);
      await setDoc(orderRef, { shopUid: profile.id, shopName: profile.name, productId: selected.id, productName: selected.name, quantity, amount: total, status: "pending", createdAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + seconds * 1000) });
      void writeOperationalLog("order_qr_created", `${orderRef.id}:${total}`);
      setOrder({ id: orderRef.id, amount: total });
      setMsg(`주문 QR을 만들었습니다. ${seconds}초 동안 한 번만 결제할 수 있습니다.`);
    } catch (e) {
      setMsg(friendlyError(e));
    }
  }
  return (
    <>
      <section className="balance">
        <span>현재 누적 매출</span>
        <strong>{won(profile.balance)}</strong>
        <small>{profile.name}</small>
      </section>
      <section className="panel shop-products">
        <h2>상품 및 가격 등록</h2>
        <form className="product-form" onSubmit={addProduct}>
          <input maxLength="40" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="상품명" />
          <input inputMode="numeric" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value.replace(/\D/g, "") })} placeholder="가격" />
          <button>상품 등록</button>
        </form>
        <div className="product-list">
          {!products.length && <div className="empty">등록된 상품이 없습니다.</div>}
          {products.map((product) => (
            <div className="row" key={product.id}>
              <div><b>{product.name}</b><small>{won(product.price)} · {product.active === false ? "판매 중지" : "판매 중"}</small></div>
              <button className="secondary" onClick={() => selectProduct(product)} disabled={product.active === false}>QR 상품 선택</button>
              <button className="danger" onClick={() => deleteDoc(doc(db, "shops", profile.id, "products", product.id))}>삭제</button>
            </div>
          ))}
        </div>
      </section>
      <section className="panel booth-pay">
        <h2>주문 QR 생성</h2>
        <div className="booth-grid">
          <div>
            <h3>QR 상품 선택</h3>
            {!selected && <p className="empty">위에서 QR로 만들 상품 하나를 선택하세요.</p>}
            {selected && <div className="cart-row"><span>{selected.name}</span><span>{won(selected.price)}</span><button className="secondary" onClick={() => setQuantity((n) => Math.max(1, n - 1))}>-</button><b>{quantity}</b><button className="secondary" onClick={() => setQuantity((n) => Math.min(20, n + 1))}>+</button></div>}
            <div className="cart-total"><span>결제 금액</span><strong>{won(total)}</strong></div>
            <button disabled={!selected || !config.paymentsEnabled} onClick={createOrder}>결제 QR 만들기</button>
            <small>QR 1개에는 선택한 상품 하나만 담기며, 가격은 등록 상품 문서에서 검증됩니다.</small>
          </div>
          <div className="qr-box">
            {order && config.paymentsEnabled ? (
              <>
                <QRCodeSVG value={makeOrderQr({ orderId: order.id, shopId: profile.id })} size={230} level="M" />
                <strong>{won(order.amount)}</strong>
                <span>학생이 QR 결제 페이지에서 스캔합니다.</span>
              </>
            ) : (
              <div className="qr-placeholder">
                <QrCode />
                <span>
                  {config.paymentsEnabled
                    ? "주문을 만든 뒤 QR을 표시합니다."
                    : "현재 결제가 중지됨"}
                </span>
              </div>
            )}
          </div>
        </div>
      </section>
      {msg && <p className="notice">{msg}</p>}
      <HistoryList uid={profile.id} canCancel />
      <RefundRequestForm profile={profile} config={config} />
    </>
  );
}
function AutoTopUp({ profile, config }) {
  const [amount, setAmount] = useState("5000"), [order, setOrder] = useState(null), [msg, setMsg] = useState(""), [busy, setBusy] = useState(false);
  const enabled = config.autoTopupEnabled === true && config.topupEnabled !== false;
  useEffect(() => {
    if (!profile?.id) return undefined;
    return onSnapshot(query(collection(db, "topUpOrders"), where("uid", "==", profile.id), orderBy("createdAt", "desc"), limit(1)), (snap) => {
      const latest = snap.docs[0];
      if (latest) setOrder({ id: latest.id, ...latest.data() });
    }, () => setMsg("최근 충전 요청을 불러올 수 없습니다."));
  }, [profile?.id]);
  async function copy(value, label) {
    try { await navigator.clipboard.writeText(String(value)); setMsg(`${label}을(를) 복사했습니다.`); }
    catch { setMsg("복사하지 못했습니다. 길게 눌러 직접 복사해 주세요."); }
  }
  async function createOrder(e) {
    e.preventDefault();
    const requestedAmount = validAmount(amount, config.maxTopupAmount);
    if (!requestedAmount) return setMsg(`1원 이상 ${won(config.maxTopupAmount)} 이하로 입력해 주세요.`);
    setBusy(true); setMsg("");
    try {
      const call = httpsCallable(functions, "createTopUpOrder", { limitedUseAppCheckTokens: true });
      const result = await call({ requestedAmount });
      setOrder({ id: result.data.orderId, ...result.data, status: "pending", expiresAt: Timestamp.fromMillis(result.data.expiresAt) });
      setMsg("고유 입금 금액을 발급했습니다. 안내 금액 그대로 송금해 주세요.");
    } catch (error) { setMsg(friendlyError(error)); }
    finally { setBusy(false); }
  }
  const expired = order?.expiresAt?.toMillis?.() && order.expiresAt.toMillis() < Date.now();
  return <>
    <section className="panel auto-topup">
      <h2>자동 계좌 충전</h2>
      <p>입금자명을 바꾸지 않아도 됩니다. 시스템이 발급한 <b>정확한 입금 금액</b>을 학생회 계좌로 송금하면, 운영 기기의 은행 입금 알림과 자동으로 대조해 포인트를 지급합니다.</p>
      {!enabled && <p className="error">자동 계좌 충전이 아직 준비되지 않았습니다. 운영 기기 연결 상태를 관리자에게 확인해 주세요.</p>}
      <form onSubmit={createOrder}>
        <label>원하는 충전 금액<input disabled={!enabled || busy} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} placeholder="예: 5000" /></label>
        <button disabled={!enabled || busy}>{busy ? "고유 금액을 발급하는 중…" : "입금 금액 발급"}</button>
      </form>
    </section>
    {order && <section className="panel topup-order">
      <h2>{order.status === "paid" ? "충전 완료" : expired ? "입금 기한 만료" : "송금 안내"}</h2>
      {order.status === "paid" ? <p className="success">{won(order.assignedAmount)}이 자동 충전되었습니다. 지갑 잔액과 거래 내역에서 확인해 주세요.</p> : <>
        <div className="topup-amount"><span>반드시 송금할 금액</span><strong>{won(order.assignedAmount)}</strong><small>충전 포인트도 {won(order.assignedAmount)}입니다.</small></div>
        <dl className="topup-details">
          <div><dt>받는 계좌</dt><dd>{order.bankAccountLabel || config.bankAccountLabel}</dd></div>
          <div><dt>계좌번호</dt><dd>{order.bankAccountNumber || config.bankAccountNumber || "관리자 설정 필요"}</dd></div>
          <div><dt>입금 기한</dt><dd>{order.expiresAt?.toDate?.().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) || "10분"}까지</dd></div>
        </dl>
        <div className="topup-actions"><button type="button" className="secondary" onClick={() => copy(order.assignedAmount, "입금 금액")}>금액 복사</button><button type="button" className="secondary" onClick={() => copy(order.bankAccountNumber || config.bankAccountNumber, "계좌번호")}>계좌번호 복사</button></div>
        <p className="hint">은행 앱에서 평소처럼 송금하면 됩니다. 입금자명·메모는 바꾸지 마세요. 입금 알림 수신 후 자동 충전되며, 지연·불일치 건은 운영자가 확인합니다.</p>
      </>}
    </section>}
    {msg && <p className="notice">{msg}</p>}
  </>;
}
function PointControl({ profile, config }) {
  const [users, setUsers] = useState([]),
    [form, setForm] = useState({ uid: "", amount: "", memo: "" }),
    [search, setSearch] = useState(""),
    [msg, setMsg] = useState("");
  useEffect(
    () => onSnapshot(query(collection(db, "users"), orderBy("name")), (s) => setUsers(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => setMsg("계정 목록을 불러올 수 없습니다.")),
    [],
  );
  async function adjust(e) {
    e.preventDefault();
    const amount = validAmount(form.amount);
    if (!form.uid || !amount) return setMsg("대상과 올바른 충전 금액을 입력하세요.");
    try {
      if (!window.confirm(`${users.find((u) => u.id === form.uid)?.name || "선택한 사용자"}에게 ${won(amount)}을 충전합니까?`)) return;
      if (!profile || !config?.topupEnabled) throw new Error("현재 포인트 충전이 중지되어 있습니다.");
      const targetRef = doc(db, "users", form.uid), target = await getDoc(targetRef);
      if (!target.exists() || target.data().status !== "active") throw new Error("충전할 수 없는 계정입니다.");
      const transactionRef = doc(collection(db, "transactions")), batch = writeBatch(db);
      batch.update(targetRef, { balance: target.data().balance + amount, lastTransactionId: transactionRef.id, updatedAt: serverTimestamp() });
      batch.set(transactionRef, { type: "adjustment", uid: form.uid, amount, memo: form.memo.trim().slice(0, 80), participantUids: [form.uid], processedBy: profile.id, createdAt: serverTimestamp() });
      await batch.commit();
      void writeOperationalLog("points_adjusted", `${form.uid}:${amount}`);
      setForm({ uid: "", amount: "", memo: "" });
      setMsg("포인트 조절을 기록했습니다.");
    } catch (e) { setMsg(friendlyError(e)); }
  }
  const allowedRoles = isAdmin1(profile) ? ["member", "shop", "admin2", "admin1"] : ["member", "shop"];
  const visibleUsers = users.filter((u) => u.status === "active" && allowedRoles.includes(normalizeRole(u.role)) && `${u.name || ""} ${u.studentId || ""}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <><section className="panel point-control"><h2>포인트 충전</h2><p>{isAdmin1(profile) ? "1급 관리자는 모든 등급의 계정에 충전할 수 있습니다." : "2급 관리자는 일반회원과 상점 계정에만 충전할 수 있습니다."} 모든 처리는 감사 로그에 남습니다.</p><form onSubmit={adjust}>
    <label>이름·학번 검색<input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="예: 홍길동 또는 10101" /></label>
    <label>대상 계정<select required value={form.uid} onChange={(e) => setForm({ ...form, uid: e.target.value })}><option value="">선택하세요</option>{visibleUsers.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.studentId || "학번 없음"} · {roles[normalizeRole(u.role)] || u.role} · {won(u.balance)}</option>)}</select></label>
    <label>충전 금액<input required inputMode="numeric" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value.replace(/\D/g, "") })} placeholder="예: 1000" /></label>
    <label>사유<input maxLength="80" value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} placeholder="예: 환전소 수기 정산" /></label>
    <button>충전 확인 및 저장</button>
  </form>{msg && <p className="notice">{msg}</p>}</section><RefundReviewList final={false} /></>;
}
function RefundRequestForm({ profile, config }) {
  const [amount, setAmount] = useState(""), [memo, setMemo] = useState(""), [msg, setMsg] = useState("");
  async function submit(e) {
    e.preventDefault(); const value = validAmount(amount);
    if (!value) return setMsg("올바른 환불 금액을 입력하세요.");
    try { if (!config.refundEnabled) throw new Error("현재 환불 신청이 중지되어 있습니다."); await addDoc(collection(db, "refundRequests"), { requesterUid: profile.id, requesterName: profile.name, requesterRole: profile.role, amount: value, memo: memo.slice(0, 80), status: "pending", createdAt: serverTimestamp() }); void writeOperationalLog("refund_requested", String(value)); setAmount(""); setMemo(""); setMsg("환불 신청이 접수되었습니다. 관리자의 최종 승인을 기다려 주세요."); }
    catch (e) { setMsg(friendlyError(e)); }
  }
  return <form className="refund-request" onSubmit={submit}><h3>포인트 환불 신청</h3><p>등록한 환급 계좌로 이체하기 전 1급 관리자의 최종 승인이 필요합니다.</p><label>환불 금액<input required inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} placeholder={`잔액 ${won(profile.balance)} 이하`} /></label><label>사유(선택)<input maxLength="80" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="예: 축제 종료 잔액 환급" /></label><button>환불 신청</button>{msg && <p className="notice">{msg}</p>}</form>;
}
function RefundReviewList({ final }) {
  const [items, setItems] = useState([]), [msg, setMsg] = useState("");
  useEffect(() => onSnapshot(query(collection(db, "refundRequests"), orderBy("createdAt", "desc"), limit(100)), (s) => setItems(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => setMsg("환불 신청 목록을 불러올 수 없습니다.")), []);
  const visible = final ? items.filter((x) => ["pending", "reviewed"].includes(x.status)) : items.filter((x) => x.status === "pending");
  async function review(id) { try { await updateDoc(doc(db, "refundRequests", id), { status: "reviewed", reviewedBy: auth.currentUser.uid, reviewedAt: serverTimestamp() }); void writeOperationalLog("refund_reviewed", id); setMsg("1급 관리자의 최종 승인을 위해 검토 완료로 표시했습니다."); } catch (e) { setMsg(friendlyError(e)); } }
  async function finish(id, approved) { try { if (!window.confirm(approved ? "환불을 최종 승인합니까?" : "환불 신청을 반려합니까?")) return; const requestRef = doc(db, "refundRequests", id), request = await getDoc(requestRef); if (!request.exists()) throw new Error("환불 신청을 찾을 수 없습니다."); if (!approved) { await updateDoc(requestRef, { status: "rejected", finalizedBy: auth.currentUser.uid, finalizedAt: serverTimestamp() }); } else { const data = request.data(), targetRef = doc(db, "users", data.requesterUid), target = await getDoc(targetRef); if (!target.exists() || target.data().balance < data.amount) throw new Error("대상 잔액이 부족합니다."); const transactionRef = doc(collection(db, "transactions")), batch = writeBatch(db); batch.update(targetRef, { balance: target.data().balance - data.amount, lastTransactionId: transactionRef.id, updatedAt: serverTimestamp() }); batch.update(requestRef, { status: "approved", finalizedBy: auth.currentUser.uid, finalizedAt: serverTimestamp(), transactionId: transactionRef.id }); batch.set(transactionRef, { type: "refund", uid: data.requesterUid, amount: data.amount, memo: data.memo || "", participantUids: [data.requesterUid], processedBy: auth.currentUser.uid, refundRequestId: id, createdAt: serverTimestamp() }); await batch.commit(); } setMsg(approved ? "환불이 승인되었습니다." : "환불 신청을 반려했습니다."); } catch (e) { setMsg(friendlyError(e)); } }
  return <section className="panel refund-review"><h2>{final ? "환불 최종 승인" : "환불 검토 대기"}</h2><div className="list">{!visible.length && <div className="empty">처리할 환불 신청이 없습니다.</div>}{visible.map((x) => <div className="row admin-row" key={x.id}><Banknote /><div><b>{x.requesterName} · {won(x.amount)}</b><small>{x.requesterRole === "shop" ? "상점" : "사용자"} · {x.memo || "사유 없음"} · {x.status}</small></div>{final ? <><button onClick={() => finish(x.id, true)}>최종 승인</button><button className="danger" onClick={() => finish(x.id, false)}>반려</button></> : <button onClick={() => review(x.id)}>검토 완료</button>}</div>)}</div>{msg && <p className="notice">{msg}</p>}</section>;
}
function CancellationReviewList() {
  const [items, setItems] = useState([]), [msg, setMsg] = useState("");
  useEffect(() => onSnapshot(query(collection(db, "cancellationRequests"), orderBy("createdAt", "desc"), limit(100)), (s) => setItems(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => setMsg("결제 취소 신청 목록을 불러올 수 없습니다.")), []);
  async function finish(id, approved) {
    try {
      if (!window.confirm(approved ? "결제 취소를 승인하고 포인트를 되돌립니까?" : "결제 취소 신청을 반려합니까?")) return;
      const requestRef = doc(db, "cancellationRequests", id), request = await getDoc(requestRef);
      if (!request.exists()) throw new Error("결제 취소 신청을 찾을 수 없습니다.");
      if (!approved) await updateDoc(requestRef, { status: "rejected", finalizedBy: auth.currentUser.uid, finalizedAt: serverTimestamp() });
      else { const data = request.data(), payerRef = doc(db, "users", data.payerUid), shopRef = doc(db, "users", data.shopUid); const [payer, shop] = await Promise.all([getDoc(payerRef), getDoc(shopRef)]); if (!payer.exists() || !shop.exists() || shop.data().balance < data.amount) throw new Error("취소에 필요한 상점 잔액이 부족합니다."); const transactionRef = doc(collection(db, "transactions")), batch = writeBatch(db); batch.update(payerRef, { balance: payer.data().balance + data.amount, lastTransactionId: transactionRef.id, updatedAt: serverTimestamp() }); batch.update(shopRef, { balance: shop.data().balance - data.amount, lastTransactionId: transactionRef.id, updatedAt: serverTimestamp() }); batch.update(requestRef, { status: "approved", finalizedBy: auth.currentUser.uid, finalizedAt: serverTimestamp(), reversalTransactionId: transactionRef.id }); batch.set(transactionRef, { type: "cancellation", payerUid: data.payerUid, boothUid: data.shopUid, boothName: data.shopName, amount: data.amount, memo: `결제 취소: ${data.memo || ""}`.slice(0, 120), participantUids: [data.payerUid, data.shopUid], processedBy: auth.currentUser.uid, cancellationRequestId: id, originalTransactionId: data.transactionId, createdAt: serverTimestamp() }); await batch.commit(); }
      setMsg(approved ? "결제 취소를 승인했습니다." : "결제 취소 신청을 반려했습니다.");
    } catch (e) { setMsg(friendlyError(e)); }
  }
  const pending = items.filter((x) => x.status === "pending");
  return <section className="panel refund-review"><h2>결제 취소 최종 승인</h2><div className="list">{!pending.length && <div className="empty">처리할 결제 취소 신청이 없습니다.</div>}{pending.map((x) => <div className="row admin-row" key={x.id}><Banknote /><div><b>{x.shopName} · {won(x.amount)}</b><small>결제 취소 신청 · {x.memo || "상품 정보 없음"}</small></div><button onClick={() => finish(x.id, true)}>최종 승인</button><button className="danger" onClick={() => finish(x.id, false)}>반려</button></div>)}</div>{msg && <p className="notice">{msg}</p>}</section>;
}
function UserSettings({ profile, config, darkMode, setDarkMode }) {
  const [msg, setMsg] = useState(""),
    [withdrawOpen, setWithdrawOpen] = useState(false),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false);
  async function toggle(e) {
    try {
      await updateDoc(doc(db, "users", profile.id), {
        requirePaymentPassword: e.target.checked,
        updatedAt: serverTimestamp(),
      });
      setMsg("설정이 저장되었습니다.");
    } catch (e) {
      setMsg(friendlyError(e));
    }
  }
  async function withdraw(e) {
    e.preventDefault();
    const user = auth.currentUser;
    if (!user) return;
    if (isRootAdmin(user)) {
      setMsg("절대 관리자 계정은 이 화면에서 탈퇴할 수 없습니다.");
      return;
    }
    setBusy(true);
    setMsg("");
    try {
      const providerId = user.providerData[0]?.providerId;
      if (providerId === "password") {
        if (!password) throw new Error("탈퇴하려면 비밀번호를 입력해 주세요.");
        await reauthenticateWithCredential(
          user,
          EmailAuthProvider.credential(user.email, password),
        );
      } else if (providerId === "google.com") {
        await reauthenticateWithPopup(user, googleProvider);
      } else if (providerId === "github.com") {
        await reauthenticateWithPopup(user, githubProvider);
      } else {
        throw new Error("이 로그인 방식은 재인증을 지원하지 않습니다.");
      }
      await deleteDoc(doc(db, "users", profile.id));
      await deleteUser(user);
      setWithdrawOpen(false);
      setPassword("");
      setMsg("회원 탈퇴가 완료되었습니다.");
    } catch (e) {
      setMsg(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel settings-page">
      <h2>내 정보 및 설정</h2>
      <dl>
        <div>
          <dt>이름</dt>
          <dd>{profile.name}</dd>
        </div>
        <div>
          <dt>학번·식별번호</dt>
          <dd>{profile.studentId || "-"}</dd>
        </div>
        <div>
          <dt>계정</dt>
          <dd>{auth.currentUser?.email}</dd>
        </div>
        <div>
          <dt>권한</dt>
          <dd>{roles[profile.role]}</dd>
        </div>
        <div>
          <dt>잔액</dt>
          <dd>{won(profile.balance)}</dd>
        </div>
      </dl>
      <label className="switch-row">
        <div>
          <b>다크 모드</b>
          <small>어두운 화면 테마를 이 기기에 적용합니다.</small>
        </div>
        <input type="checkbox" checked={darkMode} onChange={(e) => setDarkMode(e.target.checked)} />
      </label>
      <label className="switch-row">
        <div>
          <b>결제 전 비밀번호 확인</b>
          <small>
            {config.forcePaymentPassword
              ? "관리자 정책으로 필수 적용 중"
              : "해제하면 QR 확인 후 바로 결제됩니다."}
          </small>
        </div>
        <input
          type="checkbox"
          checked={
            config.forcePaymentPassword ||
            profile.requirePaymentPassword !== false
          }
          disabled={config.forcePaymentPassword}
          onChange={toggle}
        />
      </label>
      {(profile.role === "member" || profile.role === "shop") && <RefundRequestForm profile={profile} config={config} />}
      {msg && <p className="notice">{msg}</p>}
      {!isRootAdmin(auth.currentUser) && (
        <section className="withdraw-section">
          <h3>회원 탈퇴</h3>
          <p>계정과 내 프로필이 삭제됩니다. 이미 처리된 거래 기록은 정산·감사 목적으로 보존됩니다.</p>
          <button className="danger" type="button" onClick={() => setWithdrawOpen(true)}>회원 탈퇴</button>
        </section>
      )}
      {withdrawOpen && (
        <div className="legal-backdrop" role="presentation" onClick={() => !busy && setWithdrawOpen(false)}>
          <form className="legal-modal withdraw-modal" onSubmit={withdraw} onClick={(e) => e.stopPropagation()}>
            <h2>회원 탈퇴</h2>
            <p>삭제 후에는 같은 계정으로 다시 가입 신청해야 합니다. 탈퇴를 계속하려면 재인증을 진행하세요.</p>
            {auth.currentUser?.providerData[0]?.providerId === "password" && (
              <label>비밀번호<input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
            )}
            <button className="danger" disabled={busy}>{busy ? "탈퇴 처리 중…" : "계정 삭제 및 탈퇴"}</button>
            <button type="button" className="secondary" disabled={busy} onClick={() => setWithdrawOpen(false)}>취소</button>
          </form>
        </div>
      )}
    </section>
  );
}
function Admin({ config }) {
  const [users, setUsers] = useState([]),
    [form, setForm] = useState(config),
    [msg, setMsg] = useState("");
  useEffect(() => setForm(config), [config]);
  useEffect(() => {
    const a = onSnapshot(
      query(collection(db, "users"), orderBy("createdAt", "desc")),
      (s) => setUsers(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
    );
    return () => {
      a();
    };
  }, []);
  async function changeRole(u, role) {
    try {
      await updateDoc(doc(db, "users", u.id), { role, status: u.status === "suspended" ? "suspended" : "active", updatedAt: serverTimestamp() });
      setMsg(`${u.name} 계정의 권한을 ${roles[role]}(으)로 변경했습니다.`);
    } catch (e) { setMsg(friendlyError(e)); }
  }
  async function changeStatus(u) {
    const status = u.status === "suspended" ? "active" : "suspended";
    if (!window.confirm(`${u.name} 계정을 ${status === "suspended" ? "정지" : "해제"}합니까?`)) return;
    try {
      await updateDoc(doc(db, "users", u.id), { role: normalizeRole(u.role), status, updatedAt: serverTimestamp() });
      setMsg(`${u.name} 계정을 ${status === "suspended" ? "정지" : "해제"}했습니다.`);
    } catch (e) { setMsg(friendlyError(e)); }
  }
  async function save(e) {
    e.preventDefault();
    const min = validAmount(form.minPayment),
      max = validAmount(form.maxPayment);
    if (!min || !max || min > max)
      return setMsg("결제 최소·최대 금액을 확인하세요.");
    try {
      await setDoc(doc(db, "settings", "config"), { ...form, minPayment: min, maxPayment: max, maxTopupAmount: validAmount(form.maxTopupAmount) || 50000, qrExpirySeconds: Math.min(Math.max(validAmount(form.qrExpirySeconds) || 180, 60), 300), updatedAt: serverTimestamp(), updatedBy: auth.currentUser.uid }, { merge: true });
      setMsg("운영 설정이 저장되었습니다.");
    } catch (e) { setMsg(friendlyError(e)); }
  }
  const activeUsers = users.filter((x) => x.status === "active");
  return (
    <>
      <section className="stats">
        <article>
          <span>사용자</span>
          <strong>{users.length}</strong>
        </article>
        <article>
          <span>활성 계정</span>
          <strong>{activeUsers.length}</strong>
        </article>
        <article><span>포인트 환급</span><strong>관리자 검토</strong></article>
      </section>
      <form className="panel admin-settings" onSubmit={save}>
        <h2>사이트 운영 설정</h2>
        <label>
          축제은행 이름
          <input
            value={form.festivalName || ""}
            onChange={(e) => setForm({ ...form, festivalName: e.target.value })}
          />
        </label>
        <label>
          전체 공지
          <input
            value={form.announcement || ""}
            onChange={(e) => setForm({ ...form, announcement: e.target.value })}
          />
        </label>
        <div className="toggle-grid">
          {[
            ["systemOpen", "사이트 운영"],
            ["paymentsEnabled", "결제"],
            ["topupEnabled", "충전 신청"],
            ["autoTopupEnabled", "은행 알림 자동 충전"],
            ["refundEnabled", "환불 신청"],
            ["forcePaymentPassword", "결제 비밀번호 강제"],
          ].map(([k, label]) => (
            <label className="switch-row" key={k}>
              <b>{label}</b>
              <input
                type="checkbox"
                checked={!!form[k]}
                onChange={(e) => setForm({ ...form, [k]: e.target.checked })}
              />
            </label>
          ))}
        </div>
        <div className="limit-grid">
          <label>
            최소 결제 금액
            <input
              inputMode="numeric"
              value={form.minPayment}
              onChange={(e) =>
                setForm({
                  ...form,
                  minPayment: e.target.value.replace(/\D/g, ""),
                })
              }
            />
          </label>
          <label>
            최대 결제 금액
            <input
              inputMode="numeric"
              value={form.maxPayment}
              onChange={(e) =>
                setForm({
                  ...form,
                  maxPayment: e.target.value.replace(/\D/g, ""),
                })
              }
            />
          </label>
          <label>
            1회 충전 한도
            <input inputMode="numeric" value={form.maxTopupAmount || ""} onChange={(e) => setForm({ ...form, maxTopupAmount: e.target.value.replace(/\D/g, "") })} />
          </label>
          <label>
            QR 유효 시간(초)
            <input inputMode="numeric" value={form.qrExpirySeconds || ""} onChange={(e) => setForm({ ...form, qrExpirySeconds: e.target.value.replace(/\D/g, "") })} />
          </label>
        </div>
        <div className="limit-grid">
          <label>자동 충전 계좌 표시명<input maxLength="60" value={form.bankAccountLabel || ""} onChange={(e) => setForm({ ...form, bankAccountLabel: e.target.value })} placeholder="예: 복성고 학생회" /></label>
          <label>자동 충전 계좌번호<input inputMode="numeric" maxLength="32" value={form.bankAccountNumber || ""} onChange={(e) => setForm({ ...form, bankAccountNumber: e.target.value.replace(/[^0-9-]/g, "") })} placeholder="- 없이 입력 권장" /></label>
        </div>
        <button>운영 설정 저장</button>
      </form>
      {msg && <p className="notice">{msg}</p>}
      <section className="panel">
        <h2>계정 현황</h2>
        <div className="account-table-wrap">
          <table className="account-table">
            <thead>
              <tr><th>이름</th><th>학번</th><th>현재 등급</th><th>포인트</th><th>변경할 등급</th><th>계정 상태</th><th>관리</th></tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.name || "-"}</td>
                  <td>{u.studentId || "-"}</td>
                  <td>{roles[normalizeRole(u.role)] || u.role}</td>
                  <td>{won(u.balance)}</td>
                  <td><select aria-label={`${u.name} 변경할 권한`} value={normalizeRole(u.role)} onChange={(e) => changeRole(u, e.target.value)}><option value="member">일반회원</option><option value="shop">상점</option><option value="admin2">2급 관리자</option><option value="admin1">1급 관리자</option></select></td>
                  <td><span className={`account-status ${u.status === "suspended" ? "suspended" : "active"}`}>{u.status === "suspended" ? "정지" : "활성"}</span></td>
                  <td><button className={u.status === "suspended" ? "secondary" : "danger"} onClick={() => changeStatus(u)}>{u.status === "suspended" ? "정지 해제" : "계정 정지"}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <RefundReviewList final />
      <CancellationReviewList />
      <HistoryList admin />
    </>
  );
}
function App() {
  const [darkMode, setDarkMode] = useDarkMode();
  const page = location.pathname.split("/").pop() || "index.html";
  if (page === "about.html") return <About />;
  return <AuthenticatedApp darkMode={darkMode} setDarkMode={setDarkMode} />;
}
function AuthenticatedApp({ darkMode, setDarkMode }) {
  const { loading, user, profile, config, error } = useSession();
  const page = location.pathname.split("/").pop() || "index.html";
  if (loading) return <div className="loading">불러오는 중…</div>;
  if (error)
    return (
      <main className="loading">
        <p>서비스 연결을 완료하지 못했습니다.</p>
        <p className="error">{error}</p>
        <p className="hint">관리자는 Firebase App Check의 웹 앱 등록과 reCAPTCHA 허용 도메인(bokseong.github.io)을 확인해 주세요.</p>
        <button onClick={() => location.reload()}>다시 시도</button>
        {user && <button onClick={() => signOut(auth)}>로그아웃</button>}
      </main>
    );
  if (!user) return <Auth />;
  if (!profile)
    return (
      <div className="loading">
        계정 정보를 생성하는 중입니다.
        <button onClick={() => signOut(auth)}>로그아웃</button>
      </div>
    );
  if (profile.status !== "active")
    return (
      <main className="pending">
        <ShieldCheck />
        <h1>사용할 수 없는 계정입니다</h1>
        <p>계정 상태를 확인하려면 운영자에게 문의해 주세요.</p>
        <button onClick={() => signOut(auth)}>로그아웃</button>
      </main>
    );
  if (!config.systemOpen && !isAdmin1(profile))
    return (
      <main className="pending">
        <ShieldCheck />
        <h1>현재 축제은행 운영 시간이 아닙니다</h1>
        <p>{config.announcement}</p>
        <button onClick={() => signOut(auth)}>로그아웃</button>
      </main>
    );
  let content;
  if (page === "index.html") content = <HomeDashboard profile={profile} config={config} />;
  else if (page === "history.html")
    content = <HistoryList uid={profile.id} admin={isAdmin1(profile)} canPay={profile.role === "member"} canCancel={profile.role === "shop"} />;
  else if (page === "settings.html")
    content = <UserSettings profile={profile} config={config} darkMode={darkMode} setDarkMode={setDarkMode} />;
  else if (page === "admin.html") content = isAdmin1(profile) ? <Admin config={config} /> : <AccessDenied />;
  else if (page === "points.html") content = isAdmin2(profile) ? <PointControl profile={profile} config={config} /> : <AccessDenied />;
  else if (page === "topup.html") content = profile.role === "member" ? <AutoTopUp profile={profile} config={config} /> : <AccessDenied />;
  else if (page === "booth.html") content = profile.role === "shop" ? <Shop profile={profile} config={config} /> : <AccessDenied />;
  else if (page === "payment.html" && profile.role === "member")
    content = <Pay profile={profile} config={config} />;
  else content = <AccessDenied />;
  const tabs =
    profile.role === "member"
      ? [
          ["index.html", Building2, "홈"],
          ["payment.html", QrCode, "QR 결제"],
          ["topup.html", Banknote, "충전"],
          ["history.html", History, "내역"],
          ["settings.html", Settings, "설정"],
        ]
      : profile.role === "shop"
        ? [
            ["index.html", Building2, "홈"],
            ["booth.html", QrCode, "상점"],
            ["history.html", History, "거래"],
            ["settings.html", Settings, "설정"],
          ]
        : profile.role === "admin2"
          ? [
            ["index.html", Building2, "홈"],
            ["points.html", Banknote, "포인트"],
            ["history.html", History, "거래"],
            ["settings.html", Settings, "내 정보"],
          ]
          : [
            ["index.html", Building2, "홈"],
            ["admin.html", ShieldCheck, "관리"],
            ["points.html", Banknote, "충전"],
            ["history.html", History, "거래"],
            ["settings.html", Settings, "내 정보"],
          ];
  return (
    <div className="shell">
      <header>
        <a
          className="brand"
          href={`${base}index.html`}
        >
          <Building2 />
          {config.festivalName}
        </a>
        <div>
          <span>
            {profile.name} · {roles[profile.role]}
          </span>
          <button className="logout" onClick={() => signOut(auth)}>
            <LogOut />
            로그아웃
          </button>
        </div>
      </header>
      {config.announcement && (
        <div className="announcement">{config.announcement}</div>
      )}
      {tabs.length > 0 && (
        <nav>
          {tabs.map(([file, Icon, label]) => (
            <a
              key={file}
              className={
                page === file
                  ? "active"
                  : ""
              }
              href={`${base}${file}`}
            >
              <Icon />
              {label}
            </a>
          ))}
        </nav>
      )}
      <main className="content">{content}</main>
    </div>
  );
}
createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
    <SiteFooter />
  </React.StrictMode>,
);
