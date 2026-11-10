import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const [email, deviceId, publicKeySpki, packageList] = process.argv.slice(2);
if (!email || !deviceId || !publicKeySpki || !packageList) {
  console.error("사용법: node scripts/register-collector.mjs <collector-email> <device-id> <public-key-spki-base64> <은행앱-package,은행앱-package>");
  process.exit(1);
}
initializeApp({ credential: applicationDefault(), projectId: "hs-bokseong" });
const auth = getAuth(), db = getFirestore();
const user = await auth.getUserByEmail(email);
await auth.setCustomUserClaims(user.uid, { ...(user.customClaims || {}), collector: true });
await db.doc(`collectorDevices/${deviceId}`).set({
  uid: user.uid,
  email,
  publicKeySpki,
  allowedPackages: packageList.split(",").map((item) => item.trim()).filter(Boolean),
  status: "active",
  createdAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp(),
}, { merge: true });
console.log(`수집기 등록 완료: ${deviceId}`);
console.log("이미 로그인되어 있던 Android 수집기는 로그아웃 후 다시 로그인해 collector 권한 토큰을 갱신하세요.");
