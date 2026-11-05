import {describe,it,expect} from 'vitest';import {validAmount,won,friendlyError} from './domain.js';
describe('금액 검증',()=>{it('양의 정수만 허용',()=>{expect(validAmount('1000')).toBe(1000);expect(validAmount('-1')).toBeNull();expect(validAmount('1.2')).toBeNull();expect(validAmount('1000001')).toBeNull()})});
describe('표시',()=>{it('원화 표시',()=>expect(won(12340)).toBe('12,340원'));it('오류 한글화',()=>expect(friendlyError({code:'auth/invalid-credential'})).toContain('비밀번호'))});
