import {describe,it,expect} from 'vitest';import {makePaymentQr,parsePaymentQr} from './qr.js';
describe('결제 QR',()=>{it('생성과 해석',()=>{const q=parsePaymentQr(makePaymentQr({boothId:'b1',boothName:'1반',amount:3000,memo:'떡볶이'}));expect(q.boothId).toBe('b1');expect(q.amount).toBe(3000)});it('다른 QR 거부',()=>expect(()=>parsePaymentQr('https://example.com')).toThrow())});
