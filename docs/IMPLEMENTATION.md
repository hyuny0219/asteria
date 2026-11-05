# 구현 메모

## 구조
- `src/core/` — DOM 없는 순수 로직. Node에서 그대로 테스트합니다.
- `src/platform/` — 저장(IndexedDB/localStorage), 쓰기 잠금, 오디오.
- `src/render/` — Canvas2D 전투 렌더러. 상태를 읽기만 합니다.
- `src/ui/` — DOM/SVG 화면. 행동은 모두 `game.transact`를 거칩니다.

## 루프
- 로직: 50ms 고정 틱. rAF 실제 dt는 250ms로 자르고 누적값으로 틱을 돌립니다(한 프레임 최대 200틱).
- 렌더: 틱 사이 보간 alpha로 위치만 보간합니다.
- 피해·궁극기 게이지·보상은 행동의 **타격 이벤트**(일반 공격 45%, 스킬 300ms, 궁극기 700ms)에서만 처리합니다. 프레임 수와 무관합니다.
- 숨김 → 복귀 시 누적값을 버리고, 30초 이상이면 방치 정산으로 처리합니다(둘 중 하나만).

## 모드 상태 머신
`BOOT → LOAD → FARM ⇄ BOSS / DUNGEON / PROMOTION_TRIAL → RESULT → FARM`, 실패는 `DEFEAT → FARM`, 복귀는 `OFFLINE → FARM`, 다른 탭이 가져가면 `CONFLICT`.

## 능력치 합성 순서
기본 + 레벨 → 성장 강화 → 장비(+5%/강화 단계) → 갈래 패시브 → 상한(치명 60%, 공속 3.0) → 전투 중 버프(전장의 외침, 광폭 저체력).

## 저장 트랜잭션
1. 상태 복제 → 변경 → 검증 → `commit(revision+1)`.
2. 성공해야 라이브 상태를 교체합니다. 실패하면 변경은 버리고 오류 화면을 띄웁니다.
3. 커밋 중에는 시뮬레이션을 멈춥니다(`busy`).
4. IndexedDB는 `current`/`previousGood` 두 슬롯, FNV 체크섬. revision이 맞지 않으면 충돌로 거절합니다.
5. 보상 연출은 커밋이 끝난 뒤에만 시작합니다.
6. 방치 보상은 `pendingClaim`(claimId)으로 먼저 저장하고, 수령은 claimId 중복을 거절합니다.
7. 던전 입장은 입장권 차감과 진행 기록을 함께 저장하고, 중단된 기록은 다음 실행 때 환급합니다.

## 에셋 적용 현황
| 분류 | 원본 | 실행용 | 상태 |
|---|---|---|---|
| 세린 기본 8포즈 | serin_poses + atlas.json | hero_*.webp, 공통 축척·피벗 | 키 포즈 전환 + 트윈 |
| 승급 2갈래 | 원화 | promo_knight/berserker + 초상 | 정적 1장 + 트윈 |
| 일반 적 6 | bestiary 보드 | M01–M06.webp | 정적 + 변형 |
| 보스 3 | bestiary 보드 | B01–B03.webp(넓힌 영역) | 정적 + 변형 |
| 아이콘 32 | items/skills 보드 | 96px webp | 적용 |
| 배경 4 | backgrounds | 1024×683 webp | 단일 레이어 |
| UI SVG | ui/*.svg | icons.js, wordmark.svg | 적용 |
| 폰트 | Noto Sans KR | WOFF2 서브셋 2종 | 적용(OFL) |

메타데이터(`assets/runtime/sprites.json`): 원본 영역, trimOffset, 피벗, 히트박스, 알파 처리값, 애니메이션 이벤트 시점.
