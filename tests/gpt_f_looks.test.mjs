import test from 'node:test';
import assert from 'node:assert/strict';
import { lookFor, refreshLook } from '../src/core/items.js';

test('GPT F: epic+ gear uses its own icon per slot / class weapon', () => {
  assert.equal(lookFor('gloves', 'epic').icon, 'I49');
  assert.equal(lookFor('boots', 'mythic').icon, 'I54');
  assert.equal(lookFor('ring', 'legendary').icon, 'I56');
  assert.equal(lookFor('weapon', 'mythic', 'mage').icon, 'I60');
  assert.equal(lookFor('weapon', 'epic', 'archer').icon, 'I61');
  assert.equal(lookFor('weapon', 'legendary', 'rogue').icon, 'I65');
  assert.equal(lookFor('weapon', 'mythic', 'warrior').icon, 'I69');
  assert.equal(lookFor('necklace', 'mythic').icon, 'I70');
  assert.equal(lookFor('necklace', 'legendary').icon, 'I11');   // no new art → old look
  assert.equal(lookFor('helmet', 'mythic').icon, 'I05');
  assert.equal(lookFor('gloves', 'rare').icon, 'I26');
});

test('GPT F: saved items pick up the new look (class weapon read from old icon, set names kept)', () => {
  const bow = { slot: 'weapon', rarity: 'legendary', look: 'I45', name: '가시나무 장궁' };
  assert.equal(refreshLook(bow), true);
  assert.equal(bow.look, 'I62');
  const sword = { slot: 'weapon', rarity: 'epic', look: 'I01', name: '금장 장검' };
  refreshLook(sword);
  assert.equal(sword.look, 'I67');
  const setRing = { slot: 'ring', rarity: 'mythic', look: 'I35', name: '흑장미 세트 반지', set: 'rose' };
  refreshLook(setRing);
  assert.equal(setRing.look, 'I57');
  assert.equal(setRing.name, '흑장미 세트 반지');
  const helm = { slot: 'helmet', rarity: 'mythic', look: 'I05', name: '흑장미 투구' };
  assert.equal(refreshLook(helm), false);
  assert.equal(refreshLook(bow), false);   // idempotent
});
