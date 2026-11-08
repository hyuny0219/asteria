// 운영 우편 (operator mail). Delivered once per profile, on the first load inside [from, to).
// Times are KST written as UTC instants. `minLevel` limits who receives it.
// rewards: gold / gem / ore / eqTicket / skTicket / awakenStone / starShard / petEgg / petFood
//          and optionally item: { slot, rarity } (generated when the mail is claimed).
const KST = (y, m, d, hh = 0, mm = 0) => Date.UTC(y, m - 1, d, hh - 9, mm);

export const OPS_MAIL = Object.freeze([
  {
    id: 'welcome',
    from: KST(2026, 1, 1), to: KST(2099, 1, 1),
    title: '아스테리아에 오신 것을 환영합니다',
    body: '모험을 시작하는 선배님께 작은 선물을 보내 드려요. 뽑기권으로 장비와 스킬을 마련해 보세요!',
    rewards: { gem: 300, eqTicket: 5, skTicket: 3 },
  },
  {
    id: 'v8-update',
    from: KST(2026, 11, 7), to: KST(2026, 12, 1),
    title: 'v8 업데이트 기념 선물',
    body: '쐐기 던전 · 원정 파견 · 월드 보스 · 제작소가 열렸어요. 새 콘텐츠를 즐기는 데 보태 쓰세요.',
    rewards: { gem: 500, eqTicket: 10, skTicket: 5 },
  },
  {
    id: 'v12-steeds',
    from: KST(2026, 11, 8), to: KST(2099, 1, 1),
    title: '탈것 · 날개 오픈 기념',
    body: '이동 구간에서 함께 달릴 검은 군마와 흑장미 깃털 날개를 보내 드려요. 소환권과 먹이·깃털도 넣었어요.',
    rewards: { mount: 'horse', wing: 'rose', mountTicket: 3, wingTicket: 3, mountFood: 60, wingFeather: 60 },
  },
]);
