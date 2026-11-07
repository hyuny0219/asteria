// 쿠폰: only salted SHA-256 hashes of the codes live here (make new ones with
// `node tools/make_coupon.mjs <CODE>`). Times are KST written as UTC instants.
const KST = (y, m, d, hh = 0, mm = 0) => Date.UTC(y, m - 1, d, hh - 9, mm);

export const COUPONS = Object.freeze([
  { hash: '87faa17ceffb9be4404448a831862371f2f614a2a72f76a1447ead604998556d', title: '아스테리아 2026', rewards: { gem: 1000, eqTicket: 10 }, until: KST(2026, 12, 31, 23, 59) },
  { hash: '9465bc394744354a7166488509fe1525da5dfd83f79e57483a12250f5d409bf5', title: '녹턴', rewards: { skTicket: 10, gem: 300 }, until: KST(2026, 12, 31, 23, 59) },
  { hash: '3087d123c954ca1e2803b08a5a8ee3f2caef5d2001fae2184ce99280addbc281', title: '선배의 선물', rewards: { gem: 3000, eqTicket: 20, skTicket: 10, petEgg: 1 }, until: KST(2026, 12, 31, 23, 59) },
]);
