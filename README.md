# 복성고 축제은행 운영 가이드

최종 수정: 2026-11-12  
대상 사이트: <https://bokseong.github.io/bank/>

## 1. 시스템 구성

| 구분 | 사용 서비스 | 역할 |
| --- | --- | --- |
| 웹 화면 | GitHub Pages | 로그인, QR 결제, 상점 관리, 관리자 화면 제공 |
| 사용자 인증 | Firebase Authentication | 이메일/비밀번호, Google, GitHub 로그인 |
| 주요 데이터 | Cloud Firestore | 사용자, 상품, 주문, 거래, 환불·취소 요청, 운영 설정 저장 |
| 운영 로그 | Realtime Database | 입금 확인기·운영 이벤트 로그 저장 |
| 서버 처리 | Cloud Functions 2세대 | 충전 요청, 입금 알림 수집, 입금 확정 처리 |
| 악용 방지 | Firebase App Check + reCAPTCHA Enterprise/Fraud Defense | 비정상 웹 클라이언트와 토큰 재사용 요청 차단 |
| 입금 알림 수집기 | Android Flutter 앱 | 1급 관리자 전용 로그인, 지정 은행 앱 알림의 로컬 감지·표시 |

Firebase Storage는 파일 업로드·다운로드 기능이 없어 사용하지 않는다. 웹 설정에도 `storageBucket`을 지정하지 않으며, Functions 배포에 필요한 일반 Cloud Storage·Artifact Registry 서비스와 구분한다.

> 실제 은행 송금·계좌이체는 사이트가 자동 실행하지 않습니다. 입금 확인 담당자가 실제 은행 거래내역을 대조한 뒤 포인트를 지급합니다.
>
> Android 수집기는 현재 **입금 알림을 기기에 기록하는 단계**까지만 구현되어 있다. 알림을 서버로 보내 자동 충전하는 기능은 `collector` Custom Claim, 등록 기기 공개키·서명, 허용 은행 앱 목록을 모두 갖춘 뒤에만 활성화할 수 있다.

## 2. 접속 주소와 계정 등급

### 주요 주소

- 홈: <https://bokseong.github.io/bank/>
- 관리자: `admin.html`
- 포인트 충전: `points.html`
- 입금 확인: `deposit.html`
- 상점 관리: `booth.html`
- 거래 내역: `history.html`
- 내 정보·설정: `settings.html`

### 등급별 권한

| 등급 | 가능한 작업 |
| --- | --- |
| 일반회원 | QR 결제, 충전 신청, 자신의 거래 내역 조회, 결제 건 환불·취소 요청 또는 동의 |
| 상점 | 상품·가격 등록, 주문 QR 생성, 자신의 거래 내역 조회, 결제 건 환불·취소 요청 또는 동의 |
| 2급 관리자 | 일반회원·상점 포인트 충전 |
| 1급 관리자 | 계정 권한·상태 관리, 운영 설정, 모든 등급 대상 포인트 충전 |
| 입금 확인 담당자 | 충전 요청 조회, 실제 입금 대조 후 포인트 지급 |

절대 관리자 계정은 `github.jwastro09@gmail.com`입니다. 이 계정은 일반 운영 계정과 분리해 관리합니다.

## 3. 축제 전 준비

### 3.1 Firebase Console 확인

1. Firebase Authentication에서 이메일/비밀번호, Google, GitHub 로그인 제공업체가 활성화되어 있는지 확인한다.
2. Authentication → 설정 → 승인된 도메인에 `bokseong.github.io`가 있는지 확인한다.
3. Firestore와 Realtime Database가 활성화되어 있는지 확인한다.
4. App Check에서 웹 앱 `bank`가 Fraud Defense(reCAPTCHA Enterprise) 제공업체로 등록되어 있는지 확인한다.
5. App Check의 Firestore, Realtime Database, Authentication 적용 상태와 요청 지표를 확인한다.
6. Android 앱 `kr.hsbokseong.bank_collector`는 App Check에 별도로 등록한다. 개발용 debug APK는 Debug provider, 현재 정식 release APK는 코드에 설정된 Fraud Defense(reCAPTCHA provider)를 사용한다.
7. Google 로그인에는 Android 앱의 패키지명과 debug/release 서명키 SHA-1·SHA-256이 Firebase 프로젝트 설정에 등록되어 있어야 한다. 지문을 추가한 경우 `android/app/google-services.json`을 다시 내려받아 교체한다.

### 3.2 Functions App Check 확인

충전과 입금 확인 함수는 App Check 토큰이 없거나 유효하지 않으면 실행되지 않도록 구성되어 있다.

Functions 런타임 서비스 계정에는 아래 역할이 필요하다.

```text
Firebase App Check Token Verifier
```

경로:

```text
Google Cloud Console → IAM 및 관리자 → IAM
→ Functions 2세대 런타임 서비스 계정 선택
→ 역할 추가 → Firebase App Check Token Verifier
```

### 3.3 계정 발급과 권한 배정

1. 운영자는 일반 로그인 화면에서 최초 로그인한 계정의 이름·학번을 확인한다.
2. 1급 관리자가 관리자 화면의 계정 표에서 등급을 지정한다.
3. 입금 확인 기기를 사용할 계정에는 반드시 `입금 확인 담당자` 등급만 부여한다.
4. 상점 기기에는 상점 계정을 사용하고, 개인 계정과 공유하지 않는다.
5. 축제 종료 뒤에는 입금 확인 담당자·상점 계정의 권한을 회수하거나 정지한다.

역할값은 새 데이터에서 `member`, `shop`, `admin2`, `admin1`, `deposit_checker`만 사용한다. 기존의 `student`, `booth`, `admin` 값은 이전 버전 호환용이다. 특히 Android 수집기는 현재 `admin1`만 로그인 허용하므로, 기존 최고관리자 문서의 `role: "admin"`은 정식 운영 전에 `role: "admin1"`으로 이전한다.

## 4. 행사 당일 운영

### 4.1 상점 주문·결제

1. 상점 계정으로 로그인한다.
2. 상점 관리 페이지에서 상품 이름, 가격, 판매 상태를 등록한다.
3. 판매할 상품과 수량을 선택해 임시 주문 QR을 만든다.
4. 일반회원이 홈 또는 QR 결제 페이지에서 QR을 촬영한다.
5. 포인트가 회원 계정에서 차감되고 상점 계정에 지급되면 거래 내역을 확인한다.

QR은 주문별로 유효 시간이 있으며, 이미 결제된 QR은 다시 사용할 수 없다.

### 4.2 포인트 충전

#### 관리자 수기 충전

- 1급 관리자는 일반회원, 상점, 2급 관리자, 1급 관리자에게 충전할 수 있다.
- 2급 관리자는 일반회원과 상점에게만 충전할 수 있다.
- 충전 전 실제 현금 수납 또는 입금 여부를 반드시 확인한다.
- 충전 사유를 기록한다.

#### 입금 확인 기반 충전

1. 일반회원이 충전 페이지에서 `1,000P`, `2,000P`, `3,000P`, `5,000P`, `10,000P` 중 하나를 선택한다.
2. 시스템은 본인확인용 두 자리 난수(50~99)를 포함해 실제 송금액을 발급한다. 실제 송금액은 충전 포인트보다 **1~50원 적다**.
3. 학생은 안내된 실제 송금액을 운영 계좌에 송금한다. 10,000P 초과 금액 또는 현금 충전은 기부 부스에 문의한다.
4. 발급 안내는 1분만 유효하다. 만료되었거나 다른 금액을 입금한 경우 운영자가 임의 지급하지 말고 기부 부스에서 처리한다.
5. 입금 확인 담당자가 `입금 확인` 페이지에서 실제 은행 거래내역의 금액·시각과 발급 주문을 대조한다.
6. 일치할 때만 `입금 확인·지급`을 실행한다.

입금 확인은 되돌리기 어렵다. 입금자명만으로 판단하지 말고 **입금 금액, 시각, 실제 은행 거래내역**을 함께 대조한다.

## 5. 결제 환불·결제 취소

결제 건 환불·취소는 포인트를 되돌리는 처리이므로, 상점 또는 일반회원 한쪽만으로 완료할 수 없다.

### 처리 순서

1. 결제한 일반회원 또는 해당 상점이 거래 내역에서 `환불 요청` 또는 `결제 취소 요청`을 누른다.
2. 요청자는 자동으로 동의 상태가 된다.
3. 상대방은 같은 결제 내역에서 `동의` 또는 `거절`을 선택한다.
4. 상대방이 동의하면 즉시 포인트가 처리된다. 1급 관리자 승인은 필요하지 않다.
5. 승인 시 일반회원 포인트는 복원되고 상점 포인트는 같은 금액만큼 차감되며, 취소 거래 기록이 남는다.

### 운영 원칙

- 상점 잔액이 부족하면 환불·취소를 승인할 수 없다.
- 상대방이 거절하거나 관리자가 반려하면 포인트는 움직이지 않는다.
- 결제 한 건에는 하나의 환불·취소 요청만 만들 수 있다.
- 기존에 생성된 과거 형식의 취소 요청은 새 상호 동의 절차와 분리되어 있으므로 단독 승인하지 않는다.

### 현금 환급·출금

현금 환급·출금·계좌 환급은 운영하지 않는다. 거래 취소는 실제 현금 이동이 아니라, 결제 당사자 상호 동의에 따른 **포인트 반환**만 수행한다.

## 6. 공지·운영 설정

1급 관리자는 관리자 화면에서 다음을 조절할 수 있다.

- 사이트 운영 여부
- 결제 허용 여부
- 충전 신청 허용 여부
- 자동 충전 사용 여부
- 결제 최소·최대 금액
- 1회 충전 한도
- QR 유효 시간
- 운영 계좌 표시명·계좌번호
- 전체 공지

긴급 공지는 운영 설정의 전체 공지를 사용한다. 저장 후 연결된 클라이언트에 실시간으로 표시되도록 구성되어 있다.

## 7. 보안 운영 원칙

- 관리자 계정과 상점 계정의 비밀번호를 공유하지 않는다.
- 공용 기기에서는 사용 후 반드시 로그아웃한다.
- 계정 정지가 필요한 경우 관리자 화면에서 즉시 상태를 `정지`로 바꾼다.
- App Check 오류가 발생하면 먼저 Firebase Console에서 앱 등록, 허용 도메인, reCAPTCHA Enterprise 키를 확인한다.
- Functions는 `enforceAppCheck: true`, `consumeAppCheckToken: true`를 사용한다.
- 소비된 App Check 토큰은 함수에서 거절하도록 구성되어 있다.
- Functions 로그, Firestore 거래 기록, Realtime Database 운영 로그를 삭제하지 않는다.
- 실제 계좌번호, 환급 계좌정보, 개인식별정보를 스크린샷·공개 채팅에 올리지 않는다.
- Android Debug token은 비밀값이다. 소스 코드·GitHub·공지문에 저장하지 않으며, 개발 종료 후 Firebase App Check에서 삭제한다.
- 정식 Android APK에는 Debug provider를 사용하지 않는다. Fraud Defense 요청이 App Check 지표에서 정상 수신되는 것을 확인한 뒤 Authentication 강제를 유지한다.

## 8. 휴대폰 앱 설치·운영과 무료 배포

### 가장 쉬운 설치 방법: PWA

일반 사용자는 APK보다 `https://bokseong.github.io/bank/`의 다운로드 아이콘을 눌러 PWA를 설치한다. 이 방식은 무료이며 GitHub Pages의 최신 화면을 그대로 사용하므로 APK 업데이트가 필요 없다. 또한 `출처를 알 수 없는 앱 설치`, `제한된 설정 허용`, Play Protect 해제도 필요 없다. Web App Manifest와 Service Worker가 적용되어 Android·iOS 홈 화면 앱으로 실행된다.

다운로드 페이지: `https://bokseong.github.io/bank/download.html`

다운로드 아이콘과 다운로드 페이지는 일반 브라우저에서만 표시된다. 설치된 PWA의 standalone 모드와 `BokseongBank` 브리지가 있는 Android APK WebView에서는 아이콘을 숨기며, 다운로드 페이지에 직접 접근하면 메인 화면으로 이동한다.

#### Android

1. Chrome에서 `https://bokseong.github.io/bank/`를 연다.
2. 오른쪽 위 메뉴(⋮)에서 **홈 화면에 추가** 또는 **앱 설치**를 누른다.
3. **설치**를 누른다.
4. QR 결제 화면을 처음 사용할 때만 카메라 권한을 허용한다.

#### iPhone·iPad

1. Safari에서 `https://bokseong.github.io/bank/`를 연다.
2. **공유** → **홈 화면에 추가**를 누른다.
3. 표시되는 경우 **웹 앱으로 열기**를 켠 뒤 **추가**를 누른다.

Apple은 Safari에서 웹 사이트를 홈 화면 앱으로 추가하는 절차를 공식 지원한다. 자세한 절차는 [Apple의 홈 화면 웹 앱 안내](https://support.apple.com/guide/iphone/turn-a-website-into-an-app-iphea86e5236/ios)를 참고한다.

### GitHub Release APK 설치

APK가 반드시 필요한 경우에만 [GitHub 최신 Release](https://github.com/bokseong/bank/releases/latest)에서 내려받는다. Android는 Google Play 이외의 출처에서 받은 APK를 설치할 때 사용자가 설치 출처를 직접 허용하도록 설계되어 있다. 앱이나 웹 페이지가 이 보호 기능을 자동으로 해제할 수 없으며, 자동 우회 기능도 구현하지 않는다.

1. Release 주소가 `https://github.com/bokseong/bank/releases/`로 시작하는지 확인한다.
2. 일반 사용자 앱은 `bank-users-android-*.apk`, 입금 수집기는 `bank-collector-android-*.apk`를 받는다.
3. 같은 Release의 `SHA256SUMS.txt`와 APK의 SHA-256이 같은지 운영자가 먼저 확인한다.

```powershell
Get-FileHash -Algorithm SHA256 .\bank-users-android-*.apk
Get-Content .\SHA256SUMS.txt
```

4. APK를 열고 차단 안내가 나오면 **설정** → 현재 APK를 연 앱(Chrome 또는 파일 앱) → **이 출처 허용**을 켠다.
5. 설치가 끝나면 **설정** → **앱** → **특별한 앱 액세스** → **출처를 알 수 없는 앱 설치**에서 방금 허용한 출처를 다시 끈다. 제조사와 Android 버전에 따라 메뉴 이름은 조금 다를 수 있다.
6. Play Protect는 끄지 않는다. 단순히 Google Play 외부 앱이라는 확인 메시지가 표시되면 배포 주소·파일명·SHA-256을 확인한 뒤 진행한다. **유해한 앱**, **악성 코드** 또는 권한 오용 경고가 표시되면 설치를 중단하고 운영자에게 확인한다.

Google은 외부 출처 앱을 검사하는 [Play Protect를 계속 켜 둘 것을 권장](https://support.google.com/googleplay/answer/2812853/)하며, Android 8 이상에서는 [설치 출처별 사용자 허용이 필수](https://developer.android.com/studio/publish#publishing-unknown)라고 안내한다.

### 입금 수집기 `bank-collector` 설치

입금 수집기는 일반 학생에게 배포하지 않고, 1급 관리자 계정이 사용하는 학생회 전용 Android 기기 한 대에만 설치한다.

1. 위 APK 설치 절차와 SHA-256 검증을 완료한다.
2. 앱에 1급 관리자 계정으로 로그인한다. Firestore `users/{uid}`가 `role: "admin1"`, `status: "active"`가 아니면 앱이 자동으로 로그아웃한다.
3. 앱의 **알림 접근 설정 열기**를 누르고 `bank-collector`만 허용한다.
4. Android 13 이상에서 알림 접근이 차단될 때만 **설정** → **앱** → `bank-collector` → 오른쪽 위 메뉴(⋮) → **제한된 설정 허용**을 선택한 뒤 알림 접근을 다시 허용한다.
5. 앱이 요구하지 않는 접근성, SMS, 연락처, 통화 기록 권한은 허용하지 않는다. 현재 앱은 다른 앱의 입금 알림을 읽기 위한 `NotificationListenerService`만 사용한다.

제한된 설정은 민감한 정보 접근을 열 수 있으므로, Google도 신뢰하는 개발자의 앱에만 허용하도록 안내한다. 자세한 내용은 [Android 제한된 설정 안내](https://support.google.com/android/answer/12623953)를 참고한다.

### iOS 앱 파일에 대한 주의

- 서명되지 않은 `.ipa`는 일반 iPhone에 GitHub에서 바로 설치할 수 없다.
- 비용 없이 편하게 쓰려면 위의 Safari 홈 화면 웹 앱 방식을 사용한다.
- TestFlight·App Store 배포에는 원칙적으로 Apple Developer Program이 필요하며 연회비는 99 USD이다. 공인 교육기관은 조건을 충족하면 [Apple에 수수료 면제를 신청](https://developer.apple.com/help/account/membership/fee-waivers/)할 수 있지만, 학교 명의 조직 등록과 Apple의 승인이 필요하다.
- iOS는 다른 앱의 알림이나 은행 앱 메시지를 읽는 입금 수집기 기능을 허용하지 않으므로 `bank-collector`는 Android 전용이다.

### 무료 배포 방식 검토 결과

| 방식 | 비용 | 별도 보안 설정 | 적용 대상 | 판단 |
| --- | ---: | --- | --- | --- |
| GitHub Pages 설치형 PWA | 0원 | 불필요 | iOS·Android 일반 사용자 | 권장 |
| GitHub Release APK | 0원 | 설치 출처 허용 필요 | Android 일반 앱·입금 수집기 | 관리자·전용 기기에만 적합 |
| Android Developer Console 제한 배포 | 0원 | GitHub APK의 설치 출처 허용을 대신하지 않음 | 최대 50대의 승인 기기 | 개발자 검증 보조 수단 |
| F-Droid | 0원 | 최초 스토어 설치가 필요할 수 있음 | 완전한 오픈소스 Android 앱 | 현재 Firebase 의존성 때문에 공식 저장소 정책에 부적합 |
| Google Play | 25 USD 1회 | 불필요 | Android | 무료 아님 |
| App Store·TestFlight | 99 USD/년 | 불필요 | iOS | 교육기관 면제 승인 시에만 무료 가능 |

따라서 **iOS 일반 사용자는 PWA**, **Android 일반 사용자는 PWA 또는 APK**, **입금 수집기는 검증된 GitHub Release APK를 학생회 전용 Android 기기에 1회 설치**하는 구성이 비용과 보안을 함께 고려한 현실적인 방식이다. GitHub Release APK 자체를 일반 앱 스토어처럼 경고 없이 설치하게 만드는 무료 설정은 없다. Android Developer Console의 무료 제한 배포는 현재 공식 세부 안내 기준 최대 50대의 승인 기기를 대상으로 개발자·패키지를 등록할 수 있지만, GitHub에서 직접 받은 APK의 출처 허용 절차를 없애는 기능은 아니다. 공식 내용은 [Android 제한 배포 안내](https://support.google.com/android-developer-console/answer/17131204)에서 확인할 수 있다.

### Android 입금 수집기 운영과 정식 배포

프로젝트 위치:

```powershell
Set-Location C:\Users\user\Desktop\programming\bank_apk\bank_collector
```

### 개발용 실제 휴대폰 테스트

1. `flutter run` 또는 debug APK를 설치한다.
2. 최초 실행 로그에 출력되는 `Firebase App Check debug token`을 Firebase Console → App Check → Android 앱 → **Manage debug tokens**에 한 번만 등록한다.
3. Android 앱은 Firebase Authentication 로그인 뒤 Firestore `users/{uid}`의 `role: "admin1"`, `status: "active"`를 확인한다. 조건이 맞지 않으면 즉시 로그아웃한다.
4. Google 로그인은 앱 시작 때 설정된 Web OAuth `serverClientId`를 사용한다. GitHub 로그인은 Firebase Authentication의 GitHub 제공업체와 `https://hs-bokseong.firebaseapp.com/__/auth/handler` callback URL이 필요하다.

### 정식 release APK

1. release 서명키의 SHA-1 및 SHA-256을 Firebase Console → 프로젝트 설정 → Android 앱에 등록한다.
2. 최신 `google-services.json`을 `android/app/google-services.json`에 교체한다.
3. Firebase Console → App Check에서 Android 앱의 Fraud Defense 구성이 운영 앱과 일치하는지 확인한다.
4. release APK를 만든다.

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
C:\Users\user\Desktop\programming\bank_apk\flutter\bin\flutter.bat build apk --release
```

생성 파일:

```text
build\app\outputs\flutter-apk\app-release.apk
```

서명키 `.jks`, 비밀번호, Debug token, `google-services.json`은 GitHub에 올리지 않는다.

## 9. 코드 변경과 GitHub Pages 배포

작업 폴더:

```powershell
Set-Location C:\Users\user\Desktop\programming\bank
```

로컬 확인:

```powershell
npm.cmd test
npm.cmd run build
npm.cmd --prefix functions run lint
```

Functions 배포:

```powershell
npx.cmd firebase-tools@15.36.0 deploy --only functions --project hs-bokseong
```

Firestore 보안 규칙 배포:

```powershell
npx.cmd firebase-tools@15.36.0 deploy --only firestore:rules --project hs-bokseong
```

GitHub Pages 반영은 GitHub 저장소 `main` 브랜치에 푸시하면 Actions 워크플로로 진행된다. 푸시 전에는 반드시 최신 원격 변경을 먼저 가져온다.

```powershell
Set-Location C:\Users\user\Documents\ChatGPT\학교\bank-remote-inspect
git pull --ff-only
git status -sb
git add <변경 파일>
git commit -m "설명"
git push origin main
```

## 10. 자주 발생하는 문제

### `npm.ps1` 실행 정책 오류

Windows PowerShell에서는 `npm` 대신 아래처럼 실행한다.

```powershell
npm.cmd run build
npx.cmd firebase-tools@15.36.0 deploy --only functions --project hs-bokseong
```

### Functions 배포 중 HTTP 409

```text
unable to queue the operation
```

같은 함수의 기존 배포가 진행 중일 때 발생한다. 여러 터미널에서 동시 배포하지 말고 잠시 기다린 뒤 한 번만 재시도한다.

```powershell
npx.cmd firebase-tools@15.36.0 functions:list --project hs-bokseong
npx.cmd firebase-tools@15.36.0 deploy --only functions --project hs-bokseong
```

### App Check 400 또는 401

다음을 순서대로 확인한다.

1. `bokseong.github.io`가 Authentication 승인된 도메인인지 확인한다.
2. Firebase App Check의 웹 앱이 Fraud Defense(reCAPTCHA Enterprise)로 등록되었는지 확인한다.
3. 프런트엔드의 공개 사이트 키가 App Check 등록 키와 같은지 확인한다.
4. Functions 런타임 서비스 계정에 `Firebase App Check Token Verifier` 역할이 있는지 확인한다.
5. 브라우저 캐시를 지우거나 새로고침 후 다시 로그인한다.

### Android 앱에서 `Firebase App Check token is invalid`

1. debug APK인지 release APK인지 먼저 확인한다.
2. debug APK는 휴대폰 로그의 Debug token을 **해당 Android App Check 앱**에 등록했는지 확인한다.
3. token 등록 후 앱을 완전히 종료하고 다시 실행한다.
4. release APK는 Debug token을 쓰지 않는다. 코드와 Firebase App Check의 Fraud Defense 구성이 일치하는지 확인하고 release 서명 SHA-1·SHA-256과 최신 `google-services.json`을 확인한다.

### Android 앱이 로그인 직후 로그아웃됨

Firebase Auth 로그에 사용자 UID가 나타난 뒤 sign-out 이벤트가 바로 발생하면 인증 실패가 아니라 권한 판정 실패다. Firestore `users/{uid}`의 값을 확인한다.

```text
role: "admin1"
status: "active"
```

### Android Google 로그인 `serverClientId must be provided`

`GoogleSignIn.instance.initialize(serverClientId: ...)`에 Firebase 프로젝트의 Web OAuth Client ID가 설정되어 있는지, Android 앱의 SHA-1·패키지명·`google-services.json`이 같은 Firebase 프로젝트를 가리키는지 확인한다.

## 11. 축제 종료 절차

1. 관리자 설정에서 결제와 충전 신청을 먼저 중지한다.
2. 미처리 입금 확인 요청과 환불·취소 요청을 모두 확인한다.
3. 상점별 거래 기록과 포인트 잔액을 정산한다.
4. 거래 기록과 운영 로그를 별도로 보관한다.
5. 입금 확인 담당자와 상점 계정을 정지하거나 권한을 회수한다.
6. 운영 계좌의 실제 거래내역과 시스템 총 충전·포인트 반환 기록을 대조한다.
