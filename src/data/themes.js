// v14 주간 테마: KST 주(월요일 시작, raid/mplus와 같은 주 번호)마다 하나씩 돌아갑니다.
// mod = 화면을 켜고 하는 사냥(전투 화면)에만 붙는 규칙, bonus = 같은 사냥의 보상 배율.
// 방치 정산(오프라인)에는 mod·bonus 모두 적용하지 않습니다(UI에 표기).
// challenge = 그 주 안에 채우면 1회 받는 보상 (다음 주에 초기화).
export const THEMES = Object.freeze([
  { id: 'fire', name: '화염 주간', icon: '🔥',
    mod: { ignite: { coef: 0.1, sec: 3 } }, modText: '영웅의 기본 공격이 적을 3초간 불태워요(초당 공격력 10%).',
    bonus: { ore: 1.3 }, bonusText: '사냥 강화 광석 ×1.3',
    challenge: { key: 'kills', goal: 1500, text: '사냥터 몬스터 1,500마리 처치' }, reward: { gem: 150, ore: 300 } },
  { id: 'hunter', name: '사냥꾼 주간', icon: '🎯',
    mod: { eliteChanceMul: 2 }, modText: '정예 등장 확률 ×2 (6% → 12%).',
    bonus: { eliteDrop: 1.5 }, bonusText: '정예 장비 드롭 확률 ×1.5',
    challenge: { key: 'elites', goal: 120, text: '정예 120마리 처치' }, reward: { gem: 150, eqTicket: 3 } },
  { id: 'swarm', name: '군단 주간', icon: '🐜',
    mod: { hpMul: 0.8, spawnGapMul: 0.7 }, modText: '몬스터 체력 ×0.8, 더 빨리 몰려와요(등장 간격 ×0.7).',
    bonus: { gold: 1.25 }, bonusText: '사냥 골드 ×1.25',
    challenge: { key: 'kills', goal: 2500, text: '사냥터 몬스터 2,500마리 처치' }, reward: { gem: 150, skTicket: 2 } },
  { id: 'iron', name: '강철 주간', icon: '🛡',
    mod: { hpMul: 1.25, atkMul: 1.1 }, modText: '몬스터 체력 ×1.25, 공격력 ×1.1.',
    bonus: { exp: 1.25 }, bonusText: '사냥 경험치 ×1.25',
    challenge: { key: 'bossWins', goal: 5, text: '지역 보스 5번 처치(첫 처치·반복 모두)' }, reward: { gem: 200, awakenStone: 3 } },
  { id: 'frost', name: '서리 주간', icon: '❄',
    mod: { enemyAtkSpeed: 0.85 }, modText: '몬스터 공격이 느려져요(공격 간격 ÷0.85).',
    bonus: { gold: 1.1, exp: 1.1 }, bonusText: '사냥 골드·경험치 ×1.1',
    challenge: { key: 'stages', goal: 30, text: '스테이지 30번 클리어(같은 스테이지 반복 포함)' }, reward: { gem: 150, ore: 200 } },
  { id: 'shadow', name: '그림자 주간', icon: '🌑',
    mod: { rareChanceMul: 2, eliteHpMul: 1.3 }, modText: '희귀 정예 등장 확률 ×2, 정예 체력 ×1.3.',
    bonus: { eliteGem: 2 }, bonusText: '정예 보석 확률 ×2',
    challenge: { key: 'rares', goal: 3, text: '희귀 정예 3마리 처치' }, reward: { gem: 200, eqTicket: 2 } },
]);
