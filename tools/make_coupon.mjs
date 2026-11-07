#!/usr/bin/env node
// 쿠폰 해시 만들기: node tools/make_coupon.mjs <CODE>
// prints the normalized code and the SHA-256 hash to paste into src/data/coupons.js
import { COUPON_SALT, normalizeCoupon, hashCoupon } from '../src/core/mail.js';

const raw = process.argv.slice(2).join(' ');
if (!raw) { console.error('usage: node tools/make_coupon.mjs <CODE>'); process.exit(1); }
const code = normalizeCoupon(raw);
const hash = await hashCoupon(code);
console.log(`code  ${code}\nsalt  ${COUPON_SALT}\nhash  ${hash}`);
console.log(`\n  { hash: '${hash}', title: '…', rewards: { gem: 100 }, until: KST(2026, 12, 31, 23, 59) },`);
