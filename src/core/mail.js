// 우편함 · 쿠폰 (v9). Client-only: everything lives in the save.
//
// mail = { list: [Mail], delivered: { opsId: true }, coupons: { hash: usedAt }, seq }
// Mail = { id, title, body, sender: '운영자'|'시스템', at, expiresAt, rewards, claimedAt|null, cleanAt|null }
//   - unclaimed mail expires 30 days after arrival (removed, counted in mail.expired)
//   - claimed mail is cleaned up 7 days after claiming
// Coupons: codes are normalized (upper-case, no spaces/hyphens), salted and SHA-256 hashed;
// src/data/coupons.js only holds hashes. A redeemed coupon arrives as a "쿠폰 보상" mail.
import { OPS_MAIL } from '../data/mail.js';
import { COUPONS } from '../data/coupons.js';
import { grantMeta } from './meta.js';
import { MOUNTS, WINGS } from '../data/steeds.js';
import { makeItem } from './items.js';
import { addItems } from './economy.js';
import { hashString, makeRng } from './util.js';

export const MAIL = Object.freeze({ keepDays: 30, cleanDays: 7, max: 100 });
const DAY = 86400000;
export const COUPON_SALT = 'asteria-nocturne-v9';
export const MAIL_REWARD_NAMES = Object.freeze({ gold: '골드', gem: '보석', ore: '강화 광석', eqTicket: '장비 뽑기권', skTicket: '스킬 뽑기권',
  awakenStone: '각성석', starShard: '별의 파편', petEgg: '정령 알', petFood: '동료 먹이', ticket: '던전 입장권', item: '장비',
  mountFood: '탈것 먹이', wingFeather: '날개 깃털', mountTicket: '탈것 소환권', wingTicket: '날개 소환권', mount: '탈것', wing: '날개' });
const KEYS = Object.keys(MAIL_REWARD_NAMES);

export function defaultMail() { return { list: [], delivered: {}, coupons: {}, seq: 0, expired: 0 }; }
const box = (state) => (state.mail ||= defaultMail());

// sendMail: the one way mail enters the box (ops mail, coupons, rewards that could not be granted)
export function sendMail(state, { title, body = '', sender = '시스템', rewards = {}, now, keepDays = MAIL.keepDays, key = null }) {
  const m = box(state);
  const clean = {};
  for (const [k, v] of Object.entries(rewards || {})) if (KEYS.includes(k) && v) clean[k] = v;
  m.seq = (m.seq || 0) + 1;
  const mail = { id: key || `m${now}-${m.seq}`, title, body, sender, at: now, expiresAt: now + keepDays * DAY, rewards: clean, claimedAt: null };
  m.list.unshift(mail);
  if (m.list.length > MAIL.max) m.list.length = MAIL.max;
  return mail;
}

// drop expired unclaimed mail and old claimed mail; deliver operator mail not yet delivered
export function refreshMail(state, now, level = state.player ? state.player.level : 1) {
  const m = box(state);
  const before = m.list.length;
  const expired = m.list.filter((x) => !x.claimedAt && now >= x.expiresAt).length;
  m.list = m.list.filter((x) => (x.claimedAt ? now < x.claimedAt + MAIL.cleanDays * DAY : now < x.expiresAt));
  m.expired = (m.expired || 0) + expired;
  const added = [];
  for (const o of OPS_MAIL) {
    if (m.delivered[o.id] || now < o.from || now >= o.to) continue;
    if (o.minLevel && level < o.minLevel) continue;
    m.delivered[o.id] = now;
    added.push(sendMail(state, { title: o.title, body: o.body, sender: '운영자', rewards: o.rewards, now, key: 'ops-' + o.id }));
  }
  return { added: added.length, removed: Math.max(0, before - (m.list.length - added.length)), expired };
}

export const unclaimedCount = (state, now) => (state.mail ? state.mail.list.filter((x) => !x.claimedAt && now < x.expiresAt && Object.keys(x.rewards || {}).length).length : 0);

function grantRewards(state, mail) {
  const got = {};
  const items = [];
  for (const [k, v] of Object.entries(mail.rewards || {})) {
    if (k === 'item') {
      const rng = makeRng(hashString(mail.id));
      const it = makeItem(state, { slot: v.slot, rarity: v.rarity, level: Math.max(1, state.player.level), rng, source: 'mail' });
      addItems(state, [it]);
      items.push(it);
    } else if (k === 'mount' || k === 'wing') { grantMeta(state, { [k]: v }); (got.steeds ||= []).push({ kind: k, id: v }); }
    else { grantMeta(state, { [k]: v }); got[k] = (got[k] || 0) + v; }
  }
  return { got, items };
}

export function claimMail(state, id, now) {
  const m = box(state);
  const mail = m.list.find((x) => x.id === id);
  if (!mail) return { ok: false, reason: 'missing' };
  if (mail.claimedAt) return { ok: false, reason: 'duplicate' };
  if (now >= mail.expiresAt) return { ok: false, reason: 'expired' };
  const r = grantRewards(state, mail);
  mail.claimedAt = now;
  return { ok: true, ids: [id], ...r };
}

export function claimAllMail(state, now) {
  const m = box(state);
  const open = m.list.filter((x) => !x.claimedAt && now < x.expiresAt);
  if (!open.length) return { ok: false, reason: 'none' };
  const got = {}; const items = []; const ids = [];
  for (const mail of open) {
    const r = grantRewards(state, mail);
    for (const [k, v] of Object.entries(r.got)) got[k] = k === 'steeds' ? [...(got.steeds || []), ...v] : (got[k] || 0) + v;
    items.push(...r.items);
    mail.claimedAt = now;
    ids.push(mail.id);
  }
  return { ok: true, ids, got, items };
}

// ---------- coupons ----------
export const normalizeCoupon = (s) => String(s || '').toUpperCase().replace(/[\s\-_]+/g, '');

export async function hashCoupon(code) {
  const data = new TextEncoder().encode(COUPON_SALT + ':' + normalizeCoupon(code));
  const buf = await globalThis.crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// hash is computed outside the transaction (async); this part is synchronous
export function redeemCouponHash(state, hash, now) {
  const m = box(state);
  const c = COUPONS.find((x) => x.hash === hash);
  if (!c) return { ok: false, reason: 'coupon-unknown' };
  if (m.coupons[hash]) return { ok: false, reason: 'coupon-used' };
  if (c.from && now < c.from) return { ok: false, reason: 'coupon-unknown' };
  if (c.until && now >= c.until) return { ok: false, reason: 'coupon-expired' };
  m.coupons[hash] = now;
  const mail = sendMail(state, { title: `쿠폰 보상 · ${c.title}`, body: '입력한 쿠폰의 보상이 도착했어요. 받기를 눌러 수령하세요.', sender: '시스템', rewards: c.rewards, now });
  return { ok: true, mailId: mail.id, title: c.title, rewards: c.rewards };
}

export const rewardText = (rw) => Object.entries(rw || {}).map(([k, v]) => (k === 'item' ? `장비(${v.rarity})` : k === 'mount' || k === 'wing' ? `${MAIL_REWARD_NAMES[k]} ${steedName(k, v)}` : `${MAIL_REWARD_NAMES[k] || k} ${v}`)).join(' · ');
export const steedName = (k, id) => ((k === 'mount' ? MOUNTS : WINGS)[id] || { name: id }).name;
