import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  GithubAuthProvider,
  GoogleAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
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
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
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
import { auth, db } from "./firebase";
import { friendlyError, validAmount, won } from "./domain";
import { makeOrderQr, parseOrderQr } from "./qr";
import "../css/style.css";

const roles = {
    member: "일반회원",
    shop: "상점",
    admin1: "1급 관리자",
    admin2: "2급 관리자",
  },
  types = { payment: "결제", topup: "충전", refund: "환불", adjustment: "포인트 조절" },
  legacyRoles = { student: "member", booth: "shop", admin: "admin1" };
const base = import.meta.env.BASE_URL;
const googleProvider = new GoogleAuthProvider(),
  githubProvider = new GithubAuthProvider();
const ROOT_ADMIN_EMAIL = "github.jwastro09@gmail.com";
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
};
function useSession() {
  const [s, setS] = useState({
    loading: true,
    user: null,
    profile: null,
    config: defaultConfig,
  });
  useEffect(
    () =>
      onAuthStateChanged(auth, async (user) => {
        if (!user)
          return setS((x) => ({
            ...x,
            loading: false,
            user: null,
            profile: null,
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
        setS((x) => ({
          ...x,
          loading: false,
          user,
          profile: p.exists()
            ? {
                id: p.id,
                ...p.data(),
                role: isRootAdmin(user) ? "admin1" : normalizeRole(p.data().role),
              }
            : null,
        }));
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
      const result = await signInWithPopup(auth, provider);
      const profile = await getDoc(doc(db, "users", result.user.uid));
      if (!profile.exists() && !isRootAdmin(result.user)) {
        await signOut(auth);
        alert("계정 정보가 없습니다. 회원가입을 먼저 진행해 주세요");
        return;
      }
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
        <a className="auth-link" href={`${base}signup.html`}>
          계정이 없나요? 회원가입
        </a>
        <small className="auth-help">
          계정 또는 비밀번호를 잊었다면 축제은행 관리자에게 문의하세요.
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
      </p>
      <a className="about-button" href={`${base}about.html`}>
        이 사이트에 대해 알아보기
      </a>
    </footer>
  );
}
function About() {
  const [legal, setLegal] = useState({ terms: "", privacy: "" });
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${base}signup.html`, { cache: "no-store", signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("회원가입 페이지를 불러올 수 없습니다.");
        return response.text();
      })
      .then((source) => {
        const page = new DOMParser().parseFromString(source, "text/html");
        setLegal({
          terms: page.getElementById("terms-content")?.innerHTML || "",
          privacy: page.getElementById("privacy-content")?.innerHTML || "",
        });
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => controller.abort();
  }, []);
  const contacts = document.getElementById("site-contact-content")?.innerHTML || "";
  return (
    <main className="about-page">
      <header className="about-header">
        <a className="brand" href={base}><Building2 />복성고 축제은행</a>
        <a className="back-link" href={base}>로그인으로 돌아가기</a>
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
        {error && <div className="error">{error}</div>}
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
    ? [{ href: "admin.html", icon: ShieldCheck, title: "관리자 페이지", description: "계정 권한, 가입 승인과 운영 설정을 관리합니다." }, { href: "history.html", icon: History, title: "거래 페이지", description: "전체 거래 기록을 조회합니다." }, { href: "settings.html", icon: UserRound, title: "내 정보 조회", description: "내 계정 정보를 확인합니다." }]
    : profile.role === "admin2"
      ? [{ href: "points.html", icon: Banknote, title: "포인트 조절", description: "지급·차감 내역을 기록합니다." }, { href: "payment.html", icon: QrCode, title: "QR 결제", description: "상점의 주문 QR을 스캔합니다." }, { href: "history.html", icon: History, title: "거래 페이지", description: "포인트 조절과 결제 기록을 조회합니다." }, { href: "settings.html", icon: UserRound, title: "내 정보 조회", description: "내 계정 정보를 확인합니다." }]
      : profile.role === "shop"
        ? [{ href: "booth.html", icon: QrCode, title: "상점 관리", description: "상품·가격을 등록하고 주문 QR을 만듭니다." }, { href: "history.html", icon: History, title: "거래 페이지", description: "상점 거래 기록을 조회합니다." }, { href: "settings.html", icon: UserRound, title: "내 정보 조회", description: "내 계정 정보를 확인합니다." }]
        : [{ href: "payment.html", icon: QrCode, title: "QR 결제", description: "상점의 임시 주문 QR을 스캔합니다." }, { href: "history.html", icon: History, title: "거래 페이지", description: "내 결제 기록을 조회합니다." }, { href: "settings.html", icon: UserRound, title: "내 정보 조회", description: "내 계정 정보를 확인합니다." }];
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
    status: "pending",
    balance: 0,
    requirePaymentPassword: true,
    termsAcceptedAt: serverTimestamp(),
    privacyAcceptedAt: serverTimestamp(),
    termsVersion: "2026-11-06",
    privacyVersion: "2026-11-06",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
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
      await setDoc(doc(db, "users", c.user.uid), profileData());
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
      if (existing.exists())
        throw new Error(
          "이미 가입된 계정입니다. 로그인 페이지를 이용해 주세요.",
        );
      await setDoc(doc(db, "users", result.user.uid), profileData());
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
          학생 계정
          <br />
          회원가입
        </h1>
        <p>
          가입 신청 후 관리자의 승인을 받아야 충전과 결제를 이용할 수 있습니다.
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
            {busy ? "가입 처리 중…" : "이메일로 가입 신청"}
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
function HistoryList({ uid, admin = false, canPay = false }) {
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
  return (
    <section className="panel">
      <h2>거래 내역</h2>
      {canPay && <a className="pay-now" href={`${base}payment.html`}><QrCode /> 결제하기</a>}
      <div className="list">
        {!items.length && (
          <div className="empty">아직 거래 내역이 없습니다.</div>
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
          </div>
        ))}
      </div>
    </section>
  );
}
function AccessDenied() {
  return <main className="pending"><ShieldCheck /><h1>접근 권한이 없습니다</h1><p>이 페이지는 현재 계정의 권한으로 이용할 수 없습니다.</p><a className="about-button" href={`${base}index.html`}>홈으로 돌아가기</a></main>;
}
function RequestBox({ profile, type, enabled }) {
  const [amount, setAmount] = useState(""),
    [msg, setMsg] = useState("");
  async function send(e) {
    e.preventDefault();
    const n = validAmount(amount);
    if (!enabled) return setMsg("현재 관리자가 이 신청을 중지했습니다.");
    if (!n) return setMsg("올바른 금액을 입력하세요.");
    if (type === "refund" && n > profile.balance)
      return setMsg("잔액보다 많이 환불할 수 없습니다.");
    try {
      await addDoc(collection(db, "requests"), {
        uid: profile.id,
        type,
        amount: n,
        status: "pending",
        createdAt: serverTimestamp(),
      });
      setAmount("");
      setMsg("신청이 접수되었습니다.");
    } catch (e) {
      setMsg(friendlyError(e));
    }
  }
  return (
    <form className="request" onSubmit={send}>
      <h3>{type === "topup" ? "포인트 충전 신청" : "잔액 환불 신청"}</h3>
      <div className="amount">
        <input
          inputMode="numeric"
          disabled={!enabled}
          placeholder="금액"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
        />
        <span>원</span>
      </div>
      <button disabled={!enabled}>
        {enabled ? "신청하기" : "현재 중지됨"}
      </button>
      {msg && <small>{msg}</small>}
    </form>
  );
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
      }
      const txRef = doc(collection(db, "transactions"));
      await runTransaction(db, async (tx) => {
        const pr = doc(db, "users", profile.id),
          br = doc(db, "users", invoice.shopUid),
          or = doc(db, "orders", invoice.id);
        const [p, b, o] = await Promise.all([tx.get(pr), tx.get(br), tx.get(or)]);
        if (!p.exists() || p.data().balance < invoice.amount)
          throw new Error("잔액이 부족합니다.");
        if (
          !b.exists() ||
          !["shop", "booth"].includes(b.data().role) ||
          b.data().status !== "active"
        )
          throw new Error("사용할 수 없는 상점입니다.");
        if (
          !o.exists() ||
          o.data().status !== "pending" ||
          o.data().shopUid !== invoice.shopUid ||
          o.data().amount !== invoice.amount ||
          o.data().expiresAt?.toMillis?.() <= Date.now()
        )
          throw new Error("이미 사용되었거나 만료된 주문입니다.");
        tx.update(pr, {
          balance: p.data().balance - invoice.amount,
          lastTransactionId: txRef.id,
          updatedAt: serverTimestamp(),
        });
        tx.update(br, {
          balance: b.data().balance + invoice.amount,
          lastTransactionId: txRef.id,
          updatedAt: serverTimestamp(),
        });
        tx.update(or, {
          status: "paid",
          payerUid: profile.id,
          transactionId: txRef.id,
          paidAt: serverTimestamp(),
        });
        tx.set(txRef, {
          type: "payment",
          payerUid: profile.id,
          boothUid: invoice.shopUid,
          boothName: b.data().name,
          amount: invoice.amount,
          memo: invoice.items.map((item) => item.name).join(", ").slice(0, 120),
          orderId: invoice.id,
          participantUids: [profile.id, invoice.shopUid],
          createdAt: serverTimestamp(),
        });
      });
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
              <p>상품: {invoice.items.map((item) => `${item.name} ${item.quantity}개`).join(", ")}</p>
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
    [cart, setCart] = useState([]),
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
  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
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
  function addToCart(product) {
    if (!product.active) return;
    setOrder(null);
    setCart((items) => {
      const found = items.find((item) => item.id === product.id);
      return found
        ? items.map((item) => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item)
        : [...items, { id: product.id, name: product.name, price: product.price, quantity: 1 }];
    });
  }
  function changeQuantity(id, delta) {
    setOrder(null);
    setCart((items) => items
      .map((item) => item.id === id ? { ...item, quantity: item.quantity + delta } : item)
      .filter((item) => item.quantity > 0));
  }
  async function createOrder() {
    if (!cart.length || !config.paymentsEnabled) return;
    if (total < config.minPayment || total > config.maxPayment)
      return setMsg(`주문 금액은 ${won(config.minPayment)}~${won(config.maxPayment)}여야 합니다.`);
    try {
      const ref = await addDoc(collection(db, "orders"), {
        shopUid: profile.id,
        shopName: profile.name,
        items: cart.map(({ id, name, price, quantity }) => ({ id, name, price, quantity })),
        amount: total,
        status: "pending",
        createdAt: serverTimestamp(),
        expiresAt: Timestamp.fromMillis(Date.now() + 5 * 60 * 1000),
      });
      setOrder({ id: ref.id, amount: total });
      setMsg("5분 동안 사용할 수 있는 주문 QR을 만들었습니다.");
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
              <button className="secondary" onClick={() => addToCart(product)} disabled={product.active === false}>주문 추가</button>
              <button className="danger" onClick={() => deleteDoc(doc(db, "shops", profile.id, "products", product.id))}>삭제</button>
            </div>
          ))}
        </div>
      </section>
      <section className="panel booth-pay">
        <h2>주문 QR 생성</h2>
        <div className="booth-grid">
          <div>
            <h3>현재 주문</h3>
            {!cart.length && <p className="empty">위 상품에서 주문할 항목을 추가하세요.</p>}
            {cart.map((item) => <div className="cart-row" key={item.id}><span>{item.name}</span><span>{won(item.price)}</span><button className="secondary" onClick={() => changeQuantity(item.id, -1)}>-</button><b>{item.quantity}</b><button className="secondary" onClick={() => changeQuantity(item.id, 1)}>+</button></div>)}
            <div className="cart-total"><span>결제 금액</span><strong>{won(total)}</strong></div>
            <button disabled={!cart.length || !config.paymentsEnabled} onClick={createOrder}>임시 주문 QR 만들기</button>
            <small>QR은 생성 시점부터 5분 동안 한 번만 결제할 수 있습니다.</small>
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
      <HistoryList uid={profile.id} />
    </>
  );
}
function PointControl({ profile }) {
  const [users, setUsers] = useState([]),
    [form, setForm] = useState({ uid: "", amount: "", memo: "" }),
    [msg, setMsg] = useState("");
  useEffect(
    () => onSnapshot(query(collection(db, "users"), orderBy("name")), (s) => setUsers(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => setMsg("계정 목록을 불러올 수 없습니다.")),
    [],
  );
  async function adjust(e) {
    e.preventDefault();
    const amount = Number(form.amount);
    if (!form.uid || !Number.isInteger(amount) || amount === 0)
      return setMsg("대상과 0이 아닌 정수 조절 금액을 입력하세요.");
    try {
      await runTransaction(db, async (tx) => {
        const userRef = doc(db, "users", form.uid), txRef = doc(collection(db, "transactions"));
        const user = await tx.get(userRef);
        if (!user.exists()) throw new Error("대상 계정을 찾을 수 없습니다.");
        if (user.data().balance + amount < 0) throw new Error("잔액보다 많이 차감할 수 없습니다.");
        tx.update(userRef, { balance: user.data().balance + amount, lastTransactionId: txRef.id, updatedAt: serverTimestamp() });
        tx.set(txRef, {
          type: "adjustment", uid: form.uid, amount, memo: form.memo.trim().slice(0, 80),
          participantUids: [form.uid], processedBy: profile.id, createdAt: serverTimestamp(),
        });
      });
      setForm({ uid: "", amount: "", memo: "" });
      setMsg("포인트 조절을 기록했습니다.");
    } catch (e) { setMsg(friendlyError(e)); }
  }
  return <section className="panel point-control"><h2>포인트 조절</h2><p>양수는 지급, 음수는 차감입니다. 모든 조절은 거래 내역에 남습니다.</p><form onSubmit={adjust}>
    <label>대상 계정<select required value={form.uid} onChange={(e) => setForm({ ...form, uid: e.target.value })}><option value="">선택하세요</option>{users.filter((u) => u.status === "active").map((u) => <option key={u.id} value={u.id}>{u.name} · {roles[normalizeRole(u.role)] || u.role} · {won(u.balance)}</option>)}</select></label>
    <label>조절 금액<input required inputMode="numeric" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value.replace(/[^\d-]/g, "") })} placeholder="예: 1000 또는 -1000" /></label>
    <label>사유<input maxLength="80" value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} placeholder="예: 환전소 수기 정산" /></label>
    <button>포인트 조절 저장</button>
  </form>{msg && <p className="notice">{msg}</p>}</section>;
}
function UserSettings({ profile, config }) {
  const [msg, setMsg] = useState("");
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
      {msg && <p className="notice">{msg}</p>}
    </section>
  );
}
function Admin({ config }) {
  const [users, setUsers] = useState([]),
    [requests, setRequests] = useState([]),
    [form, setForm] = useState(config),
    [msg, setMsg] = useState("");
  useEffect(() => setForm(config), [config]);
  useEffect(() => {
    const a = onSnapshot(
      query(collection(db, "users"), orderBy("createdAt", "desc")),
      (s) => setUsers(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
    );
    const b = onSnapshot(
      query(
        collection(db, "requests"),
        where("status", "==", "pending"),
        orderBy("createdAt", "desc"),
      ),
      (s) => setRequests(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => {},
    );
    return () => {
      a();
      b();
    };
  }, []);
  async function approveUser(u, status) {
    try {
      await updateDoc(doc(db, "users", u.id), {
        status,
        updatedAt: serverTimestamp(),
      });
      setMsg(
        status === "active" ? "가입을 승인했습니다." : "가입을 거절했습니다.",
      );
    } catch (e) {
      setMsg(friendlyError(e));
    }
  }
  async function changeRole(u, role) {
    try {
      await updateDoc(doc(db, "users", u.id), { role, updatedAt: serverTimestamp() });
      setMsg(`${u.name} 계정의 권한을 ${roles[role]}(으)로 변경했습니다.`);
    } catch (e) { setMsg(friendlyError(e)); }
  }
  async function save(e) {
    e.preventDefault();
    const min = validAmount(form.minPayment),
      max = validAmount(form.maxPayment);
    if (!min || !max || min > max)
      return setMsg("결제 최소·최대 금액을 확인하세요.");
    await setDoc(
      doc(db, "settings", "config"),
      {
        ...form,
        minPayment: min,
        maxPayment: max,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    setMsg("운영 설정이 저장되었습니다.");
  }
  async function process(r, approved) {
    try {
      await runTransaction(db, async (tx) => {
        const rr = doc(db, "requests", r.id),
          ur = doc(db, "users", r.uid);
        const [rq, us] = await Promise.all([tx.get(rr), tx.get(ur)]);
        if (rq.data().status !== "pending")
          throw new Error("이미 처리된 신청입니다.");
        if (!approved) {
          tx.update(rr, {
            status: "rejected",
            processedAt: serverTimestamp(),
            processedBy: auth.currentUser.uid,
          });
          return;
        }
        const delta = r.type === "topup" ? r.amount : -r.amount;
        if (us.data().balance + delta < 0)
          throw new Error("사용자 잔액이 부족합니다.");
        const lr = doc(collection(db, "transactions"));
        tx.update(ur, {
          balance: us.data().balance + delta,
          updatedAt: serverTimestamp(),
        });
        tx.update(rr, {
          status: "approved",
          processedAt: serverTimestamp(),
          processedBy: auth.currentUser.uid,
          transactionId: lr.id,
        });
        tx.set(lr, {
          type: r.type,
          amount: r.amount,
          uid: r.uid,
          participantUids: [r.uid],
          createdAt: serverTimestamp(),
          processedBy: auth.currentUser.uid,
        });
      });
      setMsg("처리되었습니다.");
    } catch (e) {
      setMsg(friendlyError(e));
    }
  }
  const pending = users.filter((x) => x.status === "pending");
  return (
    <>
      <section className="stats">
        <article>
          <span>사용자</span>
          <strong>{users.length}</strong>
        </article>
        <article>
          <span>가입 승인 대기</span>
          <strong>{pending.length}</strong>
        </article>
        <article>
          <span>처리할 신청</span>
          <strong>{requests.length}</strong>
        </article>
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
        </div>
        <button>운영 설정 저장</button>
      </form>
      {msg && <p className="notice">{msg}</p>}
      <section className="panel">
        <h2>회원가입 승인</h2>
        <div className="list">
          {!pending.length && (
            <div className="empty">승인 대기 계정이 없습니다.</div>
          )}
          {pending.map((u) => (
            <div className="row admin-row" key={u.id}>
              <UserRound />
              <div>
                <b>{u.name}</b>
                <small>{u.studentId} · 학생</small>
              </div>
              <button onClick={() => approveUser(u, "active")}>승인</button>
              <button
                className="danger"
                onClick={() => approveUser(u, "rejected")}
              >
                거절
              </button>
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <h2>충전·환불 승인</h2>
        <div className="list">
          {!requests.length && (
            <div className="empty">처리할 신청이 없습니다.</div>
          )}
          {requests.map((r) => (
            <div className="row admin-row" key={r.id}>
              <RefreshCw />
              <div>
                <b>
                  {types[r.type]} {won(r.amount)}
                </b>
                <small>
                  {users.find((u) => u.id === r.uid)?.name || r.uid}
                </small>
              </div>
              <button onClick={() => process(r, true)}>승인</button>
              <button className="danger" onClick={() => process(r, false)}>
                거절
              </button>
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <h2>계정 현황</h2>
        <div className="list">
          {users.map((u) => (
            <div className="row" key={u.id}>
              <UserRound />
              <div>
                <b>{u.name}</b>
                <small>
                  {u.studentId || "-"} · {roles[normalizeRole(u.role)] || u.role} · {u.status}
                </small>
              </div>
              <strong>{won(u.balance)}</strong>
              <select aria-label={`${u.name} 권한`} value={normalizeRole(u.role)} onChange={(e) => changeRole(u, e.target.value)}>
                <option value="member">일반회원</option><option value="shop">상점</option><option value="admin2">2급 관리자</option><option value="admin1">1급 관리자</option>
              </select>
            </div>
          ))}
        </div>
      </section>
      <HistoryList admin />
    </>
  );
}
function App() {
  const page = location.pathname.split("/").pop() || "index.html";
  if (page === "about.html") return <About />;
  return <AuthenticatedApp />;
}
function AuthenticatedApp() {
  const { loading, user, profile, config } = useSession();
  const page = location.pathname.split("/").pop() || "index.html";
  if (loading) return <div className="loading">불러오는 중…</div>;
  if (!user) return page === "signup.html" ? <Signup /> : <Auth />;
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
        <h1>
          {profile.status === "pending"
            ? "관리자 승인을 기다리고 있습니다"
            : "사용할 수 없는 계정입니다"}
        </h1>
        <p>승인 후 축제은행 기능을 이용할 수 있습니다.</p>
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
    content = <HistoryList uid={profile.id} admin={isAdmin1(profile)} canPay={profile.role === "member" || profile.role === "admin2"} />;
  else if (page === "settings.html")
    content = <UserSettings profile={profile} config={config} />;
  else if (page === "admin.html") content = isAdmin1(profile) ? <Admin config={config} /> : <AccessDenied />;
  else if (page === "points.html") content = isAdmin2(profile) ? <PointControl profile={profile} /> : <AccessDenied />;
  else if (page === "booth.html") content = profile.role === "shop" ? <Shop profile={profile} config={config} /> : <AccessDenied />;
  else if (page === "payment.html" && (profile.role === "member" || profile.role === "admin2"))
    content = <Pay profile={profile} config={config} />;
  else content = <AccessDenied />;
  const tabs =
    profile.role === "member"
      ? [
          ["index.html", Building2, "홈"],
          ["payment.html", QrCode, "QR 결제"],
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
            ["payment.html", QrCode, "QR 결제"],
            ["history.html", History, "거래"],
            ["settings.html", Settings, "내 정보"],
          ]
          : [
            ["index.html", Building2, "홈"],
            ["admin.html", ShieldCheck, "관리"],
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
