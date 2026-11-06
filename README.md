# 복성고 축제은행

학교 축제용 선불 포인트 결제 웹 앱입니다. 학생 지갑, 충전·환불 신청, 부스 QR 결제, 부스 매출, 관리자 승인 및 변경 불가능한 거래 원장을 제공합니다.

> 이 서비스는 은행이나 법정화폐 서비스가 아닙니다. 학교 내부 행사에서만 사용하는 폐쇄형 포인트 시스템이며, 운영 전 학교의 회계·개인정보 처리 승인을 받아야 합니다.

## 운영 기능

- 학생: 이메일·Google·GitHub 로그인/회원가입, 잔액 확인, 카메라 QR 결제, 충전·환불 신청, 거래 내역, 개인 설정
- 부스: 금액·상품명을 포함한 결제 QR 생성, 실시간 누적 매출, 거래 내역
- 관리자: 운영 시간, 전체 공지, 결제·충전·환불 사용 여부, 결제 한도, 비밀번호 정책, 신청 승인, 계정·거래 현황
- 보안: Firebase Authentication 재인증, 역할 기반 Firestore Rules, 원자적 결제, 거래 원장 수정·삭제 차단
- 반응형 UI: 휴대전화·태블릿·PC 지원

## 폴더 구조

- `frontend/index.html`: 로그인 후 역할별 주요 메뉴로 이동하는 홈 페이지
- `frontend/signup.html`: 회원가입 페이지
- `frontend/about.html`: 운영 담당자, 환전소, 이용약관 및 개인정보 수집 안내 페이지
- `frontend/wallet.html`: 학생 지갑 페이지
- `frontend/payment.html`: QR 결제 페이지
- `frontend/history.html`: 거래 내역 페이지
- `frontend/settings.html`: 사용자 정보·설정 페이지
- `frontend/booth.html`: 상점 상품·가격 등록 및 임시 주문 QR 페이지
- `frontend/admin.html`: 1급 관리자용 계정 권한·운영 관리 페이지
- `frontend/points.html`: 2급 관리자 이상 포인트 조절 페이지
- `frontend/js/`: 브라우저 JavaScript·JSX와 Vite 설정
- `frontend/css/`: 화면 스타일
- `scripts/`: 브라우저에 배포되지 않는 Node.js 관리자 도구
- `dist/`: production build 결과(GitHub Pages 배포 대상)

회원가입 이용약관과 개인정보 수집·이용 안내 본문은 `frontend/signup.html`의 `terms-content`, `privacy-content` 템플릿에 있습니다. JavaScript를 수정하지 않고 해당 HTML 본문만 편집할 수 있습니다.
`about.html`은 열릴 때마다 위 두 템플릿을 `signup.html`에서 직접 읽으므로 같은 내용을 중복 수정할 필요가 없습니다. 담당자 이메일과 환전소 위치는 `frontend/about.html`의 `site-contact-content` 템플릿에서 수정합니다.

이메일이 검증된 `github.jwastro09@gmail.com` 계정은 최상위 관리자로 처리되며, 최초 로그인 시 관리자 프로필이 자동 생성됩니다.

## 1. Firebase 최초 설정

1. [Firebase Console](https://console.firebase.google.com/project/hs-bokseong/overview)에서 `hs-bokseong` 프로젝트를 엽니다.
2. **Authentication → Sign-in method**에서 `Email/Password`, `Google`, `GitHub`를 활성화하고 **Settings → Authorized domains**에 `bokseong.github.io`를 추가합니다.
3. **Firestore Database**를 Production mode로 생성합니다. 위치는 한 번 정하면 변경할 수 없으므로 학교와 가까운 위치를 선택합니다.
4. **Project settings → Service accounts → Generate new private key**에서 관리자 계정 준비용 JSON을 내려받습니다. 저장소 안에 넣거나 Git에 올리지 마세요.
5. Node.js 20 이상과 Firebase CLI를 준비합니다.

## 2. 설치 및 관리자·부스 계정 준비

PowerShell에서 실행합니다.

```powershell
git clone https://github.com/bokseong/bank.git
Set-Location .\bank
npm install
Copy-Item .\users.example.json .\users.json
```

`users.json`의 이메일·임시 비밀번호·이름을 실제 값으로 바꿉니다. 그다음 내려받은 Service Account JSON 경로를 현재 PowerShell 세션에만 지정합니다.

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = 'C:\안전한경로\hs-bokseong-service-account.json'
npm run provision -- .\users.json
Remove-Item Env:\GOOGLE_APPLICATION_CREDENTIALS
```

`users.json`은 `.gitignore`에 의해 저장소에 올라가지 않습니다. 계정 준비가 끝나면 안전하게 별도 보관하거나 삭제하세요. 최초 로그인 후 임시 비밀번호를 변경하는 운영 절차를 권장합니다.

`provision` 명령은 `admin1`, `admin2`, `shop`, `member` 계정과 `settings/config` 기본 운영 설정을 생성합니다. 신규 가입자는 `member`로 신청하며 1급 관리자가 계정 권한을 변경할 수 있습니다. 상점은 상품을 등록해 5분간 한 번만 사용할 수 있는 주문 QR을 만들고, 결제 시 주문서와 잔액이 함께 검증됩니다.

## 3. 테스트 및 GitHub Pages 배포

```powershell
npm test
npm run build
```

`main` 브랜치에 push하면 `.github/workflows/deploy-pages.yml`이 테스트와 production build를 수행한 뒤 GitHub Pages에 자동 배포합니다.

서비스 주소:

```text
https://bokseong.github.io/bank/
```

Firebase Console의 **Authentication → Settings → Authorized domains**에 `bokseong.github.io`를 추가해야 GitHub Pages에서 로그인이 정상 작동합니다.

Firestore Rules와 indexes를 변경했을 때만 별도로 실행합니다.

```powershell
npx firebase-tools login
npm run deploy:firestore
```

QR 카메라 인식은 보안 연결에서만 사용할 수 있으므로 실제 기기 점검은 GitHub Pages의 HTTPS 주소에서 진행해야 합니다. 브라우저의 카메라 권한 요청을 허용해야 합니다.

로컬 실행:

```powershell
npm run dev
```

## 실제 행사 전 필수 점검

1. 관리자 계정 발급 → 로그인 → 충전 승인 → 부스 QR 생성 → 학생 카메라 인식 → 비밀번호 확인 → 결제 → 환불 신청 흐름을 끝까지 확인합니다.
2. 학생·부스 계정에서 다른 사용자의 잔액이나 거래를 읽거나 수정할 수 없는지 확인합니다.
3. 전산실 태블릿과 학교 Wi-Fi에서 QR 인식 및 결제가 되는지 확인합니다.
4. 결제 직후 학생 화면과 부스 화면의 잔액이 동시에 바뀌는지 확인합니다.
5. 충전·환불은 현금 수납 기록과 반드시 대조하고, 관리자 2인이 함께 승인하도록 운영합니다.
6. 인터넷 장애에 대비한 종이 쿠폰 또는 수기 대장을 준비합니다.
7. 행사 종료 후 미사용 잔액 환불, 부스 정산, 계정·개인정보 보존 기간을 학교 규정에 따라 처리합니다.

관리자가 `결제 비밀번호 강제`를 켜면 모든 학생은 결제 직전에 로그인 비밀번호를 다시 입력해야 합니다. 강제를 끈 경우 학생은 자신의 설정에서 확인 절차를 끌 수 있습니다. Firestore Rules는 비밀번호가 필요한 결제에 대해 최근 5분 이내 재인증 여부를 서버 측에서도 검사합니다.

## 데이터 구조

- `users/{uid}`: 역할, 상태, 잔액
- `requests/{id}`: 충전·환불 신청 및 처리 상태
- `transactions/{id}`: 결제·충전·환불 원장(생성 후 수정·삭제 불가)

Firebase 웹 `apiKey`는 클라이언트 식별 설정이며 비밀번호가 아닙니다. 실제 접근 통제는 Authentication과 `firestore.rules`가 담당합니다. Service Account 개인 키는 절대로 웹 코드나 저장소에 포함하면 안 됩니다.
