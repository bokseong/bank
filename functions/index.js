import crypto from "node:crypto";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { getDatabase } from "firebase-admin/database";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";

initializeApp();
const db = getFirestore();
const rtdb = getDatabase();
const REGION = "asia-northeast3";
const ORDER_TTL_MS = 60 * 1000;
const LOCK_HOLD_MS = 4 * 60 * 60 * 1000;
const TOPUP_PACKAGES = [1000, 2000, 3000, 5000, 10000];
const MIN_MATCH_CODE = 50;
const MAX_MATCH_CODE = 99;
const MAX_NOTIFICATION_AGE_MS = 4 * 60 * 60 * 1000;
const MANUAL_REVIEW_TTL_MS = 24 * 60 * 60 * 1000;

function requireSignedIn(request) { if (!request.auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다."); }
function rejectReplayedAppCheck(request) {
  if (request.app?.alreadyConsumed) {
    throw new HttpsError("unauthenticated", "이미 사용된 보안 토큰입니다. 화면을 새로고침한 뒤 다시 시도해 주세요.");
  }
}
async function requireActiveRole(request, acceptedRoles) {
  requireSignedIn(request);
  const profile = await db.doc(`users/${request.auth.uid}`).get();
  if (!profile.exists || profile.data().status !== "active" || !acceptedRoles.includes(profile.data().role)) {
    throw new HttpsError("permission-denied", "이 작업을 수행할 권한이 없습니다.");
  }
  return profile.data();
}
function positiveInteger(value, field) { const number = Number(value); if (!Number.isSafeInteger(number) || number <= 0) throw new HttpsError("invalid-argument", `${field}은(는) 양의 정수여야 합니다.`); return number; }
function safeSenderName(value) { return String(value || "").replace(/[\r\n]/g, " ").trim().slice(0, 40); }
function eventHash(event) { return crypto.createHash("sha256").update(`${event.deviceId}|${event.notificationKey}|${event.receivedAt}|${event.amount}`).digest("hex"); }
function canonicalEvent(event) { return [event.deviceId, event.notificationKey, event.sourcePackage, event.receivedAt, event.amount, event.senderName || "", event.nonce].join("|"); }
function verifySignature(publicKeySpki, message, signature) { try { const key = crypto.createPublicKey({ key: Buffer.from(publicKeySpki, "base64"), format: "der", type: "spki" }); return crypto.verify("sha256", Buffer.from(message, "utf8"), key, Buffer.from(signature, "base64")); } catch { return false; } }

// The suffix is credited too, so the real deposit and in-app balance always agree.
export const createTopUpOrder = onCall({ region: REGION, enforceAppCheck: true, consumeAppCheckToken: true }, async (request) => {
  rejectReplayedAppCheck(request);
  requireSignedIn(request);
  const requestedPoints = positiveInteger(request.data?.requestedPoints, "충전 포인트");
  const [userSnap, configSnap] = await Promise.all([db.doc(`users/${request.auth.uid}`).get(), db.doc("settings/config").get()]);
  if (!userSnap.exists || userSnap.data().status !== "active") throw new HttpsError("permission-denied", "사용할 수 없는 계정입니다.");
  if (!["member", "student"].includes(userSnap.data().role)) throw new HttpsError("permission-denied", "자동 계좌 충전은 일반회원 계정만 사용할 수 있습니다.");
  const config = configSnap.exists ? configSnap.data() : {};
  if (config.systemOpen === false || config.topupEnabled === false || config.autoTopupEnabled !== true) throw new HttpsError("failed-precondition", "자동 계좌 충전이 현재 중지되어 있습니다.");
  if (!TOPUP_PACKAGES.includes(requestedPoints)) throw new HttpsError("invalid-argument", "자동 충전은 1,000P, 2,000P, 3,000P, 5,000P, 10,000P 상품만 이용할 수 있습니다. 그 밖의 금액과 현금 충전은 기부 부스에 문의해 주세요.");
  const now = Date.now(), expiresAt = Timestamp.fromMillis(now + ORDER_TTL_MS), reuseAfter = Timestamp.fromMillis(now + LOCK_HOLD_MS), start = crypto.randomInt(MIN_MATCH_CODE, MAX_MATCH_CODE + 1);
  for (let offset = 0; offset <= MAX_MATCH_CODE - MIN_MATCH_CODE; offset += 1) {
    const matchCode = MIN_MATCH_CODE + ((start - MIN_MATCH_CODE + offset) % (MAX_MATCH_CODE - MIN_MATCH_CODE + 1));
    const subsidyAmount = 100 - matchCode, transferAmount = requestedPoints - subsidyAmount;
    const lockRef = db.doc(`topupAmountLocks/${transferAmount}`), orderRef = db.collection("topUpOrders").doc();
    const assigned = await db.runTransaction(async (tx) => {
      const lock = await tx.get(lockRef);
      if (lock.exists && lock.data().reuseAfter?.toMillis?.() > now) return false;
      tx.set(lockRef, { orderId: orderRef.id, transferAmount, requestedPoints, matchCode, reuseAfter, state: "reserved", updatedAt: FieldValue.serverTimestamp() });
      tx.set(orderRef, { uid: request.auth.uid, requestedPoints, transferAmount, matchCode, subsidyAmount, status: "pending", createdAt: FieldValue.serverTimestamp(), expiresAt, bankAccountLabel: String(config.bankAccountLabel || "학생회 운영 계좌").slice(0, 60), bankAccountNumber: String(config.bankAccountNumber || "").replace(/\s/g, "").slice(0, 32) });
      return true;
    });
    if (assigned) {
      await rtdb.ref(`collectorLogs/orders/${orderRef.id}`).set({ event: "order_created", uid: request.auth.uid, requestedPoints, transferAmount, matchCode, subsidyAmount, at: Date.now() });
      return { orderId: orderRef.id, requestedPoints, transferAmount, matchCode, subsidyAmount, expiresAt: expiresAt.toMillis(), bankAccountLabel: String(config.bankAccountLabel || "학생회 운영 계좌"), bankAccountNumber: String(config.bankAccountNumber || "") };
    }
  }
  throw new HttpsError("resource-exhausted", "현재 같은 금액대의 충전 요청이 많습니다. 잠시 후 다시 시도해 주세요.");
});

export const ingestDepositNotification = onCall({ region: REGION, enforceAppCheck: true, consumeAppCheckToken: true }, async (request) => {
  rejectReplayedAppCheck(request);
  await requireActiveRole(request, ["deposit_checker"]);
  if (request.auth.token.collector !== true) throw new HttpsError("permission-denied", "등록된 입금 수집기만 사용할 수 있습니다.");
  const raw = request.data?.event || {}, amount = positiveInteger(raw.amount, "입금 금액"), receivedAt = positiveInteger(raw.receivedAt, "수신 시각");
  const deviceId = String(raw.deviceId || "").trim(), notificationKey = String(raw.notificationKey || "").trim().slice(0, 200), sourcePackage = String(raw.sourcePackage || "").trim().slice(0, 160), nonce = String(raw.nonce || "").trim().slice(0, 120), signature = String(raw.signature || "");
  if (!deviceId || !notificationKey || !sourcePackage || !nonce || !signature) throw new HttpsError("invalid-argument", "입금 알림 정보가 완전하지 않습니다.");
  if (Math.abs(Date.now() - receivedAt) > MAX_NOTIFICATION_AGE_MS) throw new HttpsError("failed-precondition", "너무 오래된 알림입니다.");
  const deviceRef = db.doc(`collectorDevices/${deviceId}`), deviceSnap = await deviceRef.get(), device = deviceSnap.data();
  if (!deviceSnap.exists || device.uid !== request.auth.uid || device.status !== "active" || !Array.isArray(device.allowedPackages) || !device.allowedPackages.includes(sourcePackage)) throw new HttpsError("permission-denied", "등록되지 않은 수집기 또는 은행 앱입니다.");
  const event = { deviceId, notificationKey, sourcePackage, receivedAt, amount, senderName: safeSenderName(raw.senderName), nonce };
  if (!verifySignature(device.publicKeySpki, canonicalEvent(event), signature)) throw new HttpsError("permission-denied", "수집기 서명을 검증하지 못했습니다.");
  const id = eventHash(event), eventRef = db.doc(`depositEvents/${id}`), lockRef = db.doc(`topupAmountLocks/${amount}`), txRef = db.collection("transactions").doc();
  const result = await db.runTransaction(async (tx) => {
    const [seen, lock] = await Promise.all([tx.get(eventRef), tx.get(lockRef)]);
    if (seen.exists) return { state: "duplicate" };
    if (!lock.exists || lock.data().state !== "reserved") { tx.set(eventRef, { ...event, state: "review_required", reason: "no_pending_amount", createdAt: FieldValue.serverTimestamp() }); return { state: "review_required", reason: "no_pending_amount" }; }
    const orderRef = db.doc(`topUpOrders/${lock.data().orderId}`), order = await tx.get(orderRef);
    if (!order.exists || order.data().status !== "pending" || order.data().expiresAt.toMillis() < Date.now()) { tx.set(eventRef, { ...event, orderId: lock.data().orderId, state: "review_required", reason: "order_expired", createdAt: FieldValue.serverTimestamp() }); return { state: "review_required", reason: "order_expired" }; }
    const userRef = db.doc(`users/${order.data().uid}`), user = await tx.get(userRef);
    if (!user.exists || user.data().status !== "active") { tx.set(eventRef, { ...event, orderId: orderRef.id, state: "review_required", reason: "user_inactive", createdAt: FieldValue.serverTimestamp() }); return { state: "review_required", reason: "user_inactive" }; }
    const requestedPoints = Number(order.data().requestedPoints || 0);
    if (!TOPUP_PACKAGES.includes(requestedPoints) || Number(order.data().transferAmount) !== amount) { tx.set(eventRef, { ...event, orderId: orderRef.id, state: "review_required", reason: "invalid_order", createdAt: FieldValue.serverTimestamp() }); return { state: "review_required", reason: "invalid_order" }; }
    tx.update(userRef, { balance: Number(user.data().balance || 0) + requestedPoints, lastTransactionId: txRef.id, updatedAt: FieldValue.serverTimestamp() });
    tx.update(orderRef, { status: "paid", paidAt: FieldValue.serverTimestamp(), depositEventId: id, transactionId: txRef.id, senderName: event.senderName });
    tx.update(lockRef, { state: "paid", depositEventId: id, updatedAt: FieldValue.serverTimestamp() });
    tx.set(txRef, { type: "topup", uid: order.data().uid, amount: requestedPoints, cashAmount: amount, subsidyAmount: Number(order.data().subsidyAmount || 0), memo: "운영 계좌 입금 자동 확인", participantUids: [order.data().uid], processedBy: `collector:${deviceId}`, topUpOrderId: orderRef.id, depositEventId: id, createdAt: FieldValue.serverTimestamp() });
    tx.set(eventRef, { ...event, orderId: orderRef.id, transactionId: txRef.id, state: "paid", createdAt: FieldValue.serverTimestamp() });
    return { state: "paid", orderId: orderRef.id, transactionId: txRef.id, uid: order.data().uid, requestedPoints, transferAmount: amount };
  });
  await rtdb.ref(`collectorLogs/deposits/${id}`).set({ ...result, amount, deviceId, receivedAt, at: Date.now() });
  logger.info("deposit notification processed", { id, ...result, amount, deviceId });
  return { eventId: id, ...result };
});

export const listPendingTopUpOrders = onCall({ region: REGION, enforceAppCheck: true, consumeAppCheckToken: true }, async (request) => {
  rejectReplayedAppCheck(request);
  await requireActiveRole(request, ["deposit_checker"]);
  const pending = await db.collection("topUpOrders").where("status", "==", "pending").limit(100).get();
  const users = await Promise.all(pending.docs.map((item) => db.doc(`users/${item.data().uid}`).get()));
  const orders = pending.docs.map((item, index) => {
    const data = item.data(), user = users[index].data() || {};
    return {
      id: item.id,
      name: String(user.name || "알 수 없음"),
      studentId: String(user.studentId || ""),
      requestedPoints: Number(data.requestedPoints || 0),
      transferAmount: Number(data.transferAmount || 0),
      matchCode: Number(data.matchCode || 0),
      createdAt: data.createdAt?.toMillis?.() || null,
      expiresAt: data.expiresAt?.toMillis?.() || null,
    };
  }).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return { orders };
});

export const confirmTopUpOrder = onCall({ region: REGION, enforceAppCheck: true, consumeAppCheckToken: true }, async (request) => {
  rejectReplayedAppCheck(request);
  const checker = await requireActiveRole(request, ["deposit_checker"]);
  const orderId = String(request.data?.orderId || "").trim();
  const confirmedAmount = positiveInteger(request.data?.confirmedAmount, "확인 금액");
  if (!orderId || orderId.length > 160) throw new HttpsError("invalid-argument", "충전 요청을 찾을 수 없습니다.");
  const orderRef = db.doc(`topUpOrders/${orderId}`), eventRef = db.doc(`depositEvents/manual-${orderId}`), txRef = db.collection("transactions").doc();
  const result = await db.runTransaction(async (tx) => {
    const [orderSnap, eventSnap] = await Promise.all([tx.get(orderRef), tx.get(eventRef)]);
    if (eventSnap.exists) return { state: "already_confirmed", transactionId: eventSnap.data().transactionId || null };
    if (!orderSnap.exists) throw new HttpsError("not-found", "충전 요청을 찾을 수 없습니다.");
    const order = orderSnap.data();
    if (order.status !== "pending") return { state: "already_confirmed", transactionId: order.transactionId || null };
    if (!TOPUP_PACKAGES.includes(Number(order.requestedPoints)) || Number(order.transferAmount) !== confirmedAmount) throw new HttpsError("invalid-argument", "은행 거래내역의 입금 금액이 발급 금액과 다릅니다.");
    const createdAt = order.createdAt?.toMillis?.() || 0;
    if (!createdAt || Date.now() - createdAt > ORDER_TTL_MS) throw new HttpsError("failed-precondition", "1분이 지난 충전 요청입니다. 기부 부스에 문의해 주세요.");
    const userRef = db.doc(`users/${order.uid}`), userSnap = await tx.get(userRef);
    if (!userSnap.exists || userSnap.data().status !== "active") throw new HttpsError("failed-precondition", "충전 대상 계정을 사용할 수 없습니다.");
    const lockRef = db.doc(`topupAmountLocks/${confirmedAmount}`);
    const requestedPoints = Number(order.requestedPoints);
    tx.update(userRef, { balance: Number(userSnap.data().balance || 0) + requestedPoints, lastTransactionId: txRef.id, updatedAt: FieldValue.serverTimestamp() });
    tx.update(orderRef, { status: "paid", paidAt: FieldValue.serverTimestamp(), depositEventId: eventRef.id, transactionId: txRef.id, confirmedBy: request.auth.uid, confirmationMethod: "manual" });
    tx.set(lockRef, { state: "paid", orderId, transferAmount: confirmedAmount, depositEventId: eventRef.id, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.set(txRef, { type: "topup", uid: order.uid, amount: requestedPoints, cashAmount: confirmedAmount, subsidyAmount: Number(order.subsidyAmount || 0), memo: "입금 확인 담당자 수동 대조", participantUids: [order.uid], processedBy: request.auth.uid, topUpOrderId: orderId, depositEventId: eventRef.id, createdAt: FieldValue.serverTimestamp() });
    tx.set(eventRef, { state: "manual_paid", orderId, transactionId: txRef.id, amount: confirmedAmount, confirmedBy: request.auth.uid, checkerName: String(checker.name || "").slice(0, 40), createdAt: FieldValue.serverTimestamp() });
    return { state: "paid", transactionId: txRef.id, uid: order.uid, requestedPoints, transferAmount: confirmedAmount };
  });
  await rtdb.ref(`collectorLogs/manualConfirmations/${orderId}`).set({ ...result, checkerUid: request.auth.uid, amount: confirmedAmount, at: Date.now() });
  logger.info("topup manually confirmed", { orderId, ...result, checkerUid: request.auth.uid, amount: confirmedAmount });
  return result;
});

export const createPaymentReversalRequest = onCall({ region: REGION, enforceAppCheck: true, consumeAppCheckToken: true }, async (request) => {
  rejectReplayedAppCheck(request);
  await requireActiveRole(request, ["member", "student", "shop", "booth"]);
  const transactionId = String(request.data?.transactionId || "").trim();
  const kind = request.data?.kind === "refund" ? "refund" : "cancellation";
  if (!transactionId || transactionId.length > 160) throw new HttpsError("invalid-argument", "결제 기록을 찾을 수 없습니다.");
  const requestRef = db.doc(`cancellationRequests/${transactionId}`), paymentRef = db.doc(`transactions/${transactionId}`);
  const result = await db.runTransaction(async (tx) => {
    const [existing, paymentSnap] = await Promise.all([tx.get(requestRef), tx.get(paymentRef)]);
    if (existing.exists) throw new HttpsError("already-exists", "이 결제 건에는 이미 환불 또는 결제 취소 요청이 있습니다.");
    if (!paymentSnap.exists || paymentSnap.data().type !== "payment") throw new HttpsError("not-found", "환불할 수 없는 결제 기록입니다.");
    const payment = paymentSnap.data(), isPayer = payment.payerUid === request.auth.uid, isShop = payment.boothUid === request.auth.uid;
    if (!isPayer && !isShop) throw new HttpsError("permission-denied", "결제 당사자만 요청할 수 있습니다.");
    tx.create(requestRef, { transactionId, kind, requesterUid: request.auth.uid, shopUid: payment.boothUid, shopName: String(payment.boothName || "상점"), payerUid: payment.payerUid, amount: Number(payment.amount), memo: String(payment.memo || "").slice(0, 120), participantUids: [payment.payerUid, payment.boothUid], payerConsent: isPayer, shopConsent: isShop, status: "awaiting_consent", createdAt: FieldValue.serverTimestamp() });
    return { status: "awaiting_consent", kind };
  });
  await rtdb.ref(`operationalLogs/reversals/${transactionId}`).set({ event: "requested", uid: request.auth.uid, kind, at: Date.now() });
  return result;
});

export const respondPaymentReversal = onCall({ region: REGION, enforceAppCheck: true, consumeAppCheckToken: true }, async (request) => {
  rejectReplayedAppCheck(request);
  await requireActiveRole(request, ["member", "student", "shop", "booth"]);
  const transactionId = String(request.data?.transactionId || "").trim(), approve = request.data?.approve === true;
  if (!transactionId || transactionId.length > 160) throw new HttpsError("invalid-argument", "환불·취소 요청을 찾을 수 없습니다.");
  const requestRef = db.doc(`cancellationRequests/${transactionId}`), reversalTxRef = db.collection("transactions").doc();
  const result = await db.runTransaction(async (tx) => {
    const requestSnap = await tx.get(requestRef);
    if (!requestSnap.exists) throw new HttpsError("not-found", "환불·취소 요청을 찾을 수 없습니다.");
    const reversal = requestSnap.data();
    if (reversal.status !== "awaiting_consent") throw new HttpsError("failed-precondition", "이미 처리된 환불·취소 요청입니다.");
    if (reversal.requesterUid === request.auth.uid || ![reversal.payerUid, reversal.shopUid].includes(request.auth.uid)) throw new HttpsError("permission-denied", "결제 상대방만 동의 또는 거절할 수 있습니다.");
    if (!approve) {
      tx.update(requestRef, { status: "declined", declinedBy: request.auth.uid, declinedAt: FieldValue.serverTimestamp() });
      return { status: "declined" };
    }
    const payerRef = db.doc(`users/${reversal.payerUid}`), shopRef = db.doc(`users/${reversal.shopUid}`), originalRef = db.doc(`transactions/${transactionId}`);
    const [payerSnap, shopSnap, originalSnap] = await Promise.all([tx.get(payerRef), tx.get(shopRef), tx.get(originalRef)]);
    if (!payerSnap.exists || !shopSnap.exists || !originalSnap.exists || originalSnap.data().type !== "payment") throw new HttpsError("failed-precondition", "결제 당사자 정보를 확인할 수 없습니다.");
    const amount = Number(reversal.amount);
    if (!Number.isSafeInteger(amount) || amount <= 0 || Number(shopSnap.data().balance || 0) < amount) throw new HttpsError("failed-precondition", "상점 포인트 잔액이 부족하여 처리할 수 없습니다.");
    tx.update(payerRef, { balance: Number(payerSnap.data().balance || 0) + amount, lastTransactionId: reversalTxRef.id, updatedAt: FieldValue.serverTimestamp() });
    tx.update(shopRef, { balance: Number(shopSnap.data().balance || 0) - amount, lastTransactionId: reversalTxRef.id, updatedAt: FieldValue.serverTimestamp() });
    tx.update(requestRef, { payerConsent: true, shopConsent: true, status: "approved", consentedBy: request.auth.uid, consentedAt: FieldValue.serverTimestamp(), reversalTransactionId: reversalTxRef.id });
    tx.create(reversalTxRef, { type: "cancellation", payerUid: reversal.payerUid, boothUid: reversal.shopUid, boothName: String(reversal.shopName || "상점"), amount, memo: `${reversal.kind === "refund" ? "환불" : "결제 취소"}: ${String(reversal.memo || "")}`.slice(0, 120), participantUids: [reversal.payerUid, reversal.shopUid], processedBy: "mutual_consent", cancellationRequestId: transactionId, originalTransactionId: transactionId, createdAt: FieldValue.serverTimestamp() });
    return { status: "approved", transactionId: reversalTxRef.id };
  });
  await rtdb.ref(`operationalLogs/reversals/${transactionId}`).update({ event: result.status, respondedBy: request.auth.uid, at: Date.now() });
  return result;
});
