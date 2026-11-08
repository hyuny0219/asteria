# 아스테리아 연대기 · NOCTURNE — MVP

모바일 세로형(390×844 기준, 360×700 대응) 자동전투 방치 RPG의 **실행 가능한 MVP**입니다.
`docs/handoff/`의 NOCTURNE v3 인계(CLAUDE_START.md, spec 01–08)를 기준으로 구현했습니다.

- 4클래스(전사 세린 · 마법사 엘레나 · 궁수 리라 · 도적 녹스) · 승급 3차(Lv 30/60/90) × 갈래 8 · Lv 1–100
- **스테이지 지도**: 지역 10 × 스테이지 10 + 보스 노드, 별 3개, 최초 클리어 보상, 자동 진행 토글 · 보스 10(+필드 보스, 광폭화) · 던전 3종(채석장·금고·서고) · 시련의 탑 · 주간 레이드(심연의 문)
- **스킬 등급(뽑기형)**: 일반·희귀·영웅·전설·신화. 스킬 뽑기 카드로 더 높은 등급이 나오면 교체(피해·대기·전설 이상 보너스), 신화 천장 150회 (`docs/DESIGN_V11_SKILL_GRADE.md`)
- 장비 6등급 · 8부위 · 랜덤 옵션 · 세트 · **슬롯 강화 +15**(장비를 바꿔도 유지) · 자동 분해 / 스킬 레벨(스킬북) · 각인 2칸 · 능력치 포인트
- 장비 뽑기 · 스킬 뽑기(게임 내 보석·뽑기권만, 확률 공개, 천장 200/100) · 일일 미션 · 출석 28일 · 복귀 보상 · 게스트 프로필 3개
- **v8 콘텐츠**(`docs/DESIGN_V8.md`): 쐐기 던전(열쇠 단계·90초 타이머·주간 변칙 2개·주간 금고) · 원정 파견(동료 3슬롯·2/4/8시간·실제 시간) · 월드 보스(12·18·21시, 60초 점수제) · 희귀 정예(지역별 10종, 도감·칭호) · 제작소(보옥 홈·합성, 슬롯 마부, 30분 버프 음식)
- 특성 트리 · 환생(Lv 100, 정수 영구 강화) · 균열(축복 3택·주간 저주, 30층)
- 도감(몬스터·장비) · 업적 32 · 칭호 10(1개 장착, 이름 옆 표시) · **무료** 시즌 패스(28일, 30레벨, 유료 트랙 없음)
- 동료 6종(정령 알 부화, 판매 없음, 확률 공개, 먹이 레벨·조각 별, 전투 보조 공격 + 오라) · 신화 제작(부위 선택)
- 하단 탭: 전투(전투 전체 화면·홈) · 스테이지 · 장비 · 스킬 · 모험 · 메뉴. 전투 외 탭은 화면 전체를 쓰고 위에 얇은 전투 상태줄(누르면 전투 탭). 능력치(확인 전용)는 메뉴 타일
- 특별 전투(보스·던전·균열·탑·레이드·교관 시련)는 화면 전환 후 전투만 크게 보이는 몰입 화면
- 전투 연출: 기본 공격 3단 콤보(클래스별 모양)·콤보 카운터, 히트스톱·화면 흔들림·흰 피격 섬광·밀려남·치명타 숫자, 스킬별 이펙트, 궁극기 컷인(초상·이름) — 표현 전용, 피해 변화 없음
- 그림: 4클래스 기본·승급 24종 8 키 포즈(GPT A01·A02), 몬스터·보스·배경·아이콘 생성 그림(`docs/KNOWN_ISSUES.md`)
- 전투 Canvas2D, UI DOM/SVG, Vanilla JS(ES 모듈, 빌드 도구·외부 의존성 없음), 폰트 Noto Sans KR(WOFF2 서브셋, OFL)
- 비도트 성인 여성 다크 판타지 일러스트. 도트·치비·픽셀 폰트·정수 확대는 사용하지 않습니다.
- **우편함 · 쿠폰**: 운영 우편(기간·1회 배달), 30일 보관·모두 받기, 쿠폰 입력(해시 저장·프로필당 1회, 보상은 우편으로) — `docs/DESIGN_V9_MAIL.md`
- **장비·스킬 v10**: 전설 고유 효과 36종(추출·보관함·이식), 스킬 각성 A/B(Lv 10), 장비·스킬 프리셋 3칸(전투 종류별 자동 교체), 재련·등급 올리기 — `docs/DESIGN_V10_GEAR.md`
- 실제 광고·결제·캐릭터 가챠·호감도는 없습니다(뽑기는 게임 내 재화만).

## 실행

```bash
node tools/serve.mjs          # http://localhost:8000/
# 또는 python3 -m http.server 8000
```
브라우저에서 `http://localhost:8000/`을 엽니다. ES 모듈과 fetch를 쓰므로 `file://`로 직접 열면 동작하지 않습니다.
`?autostart`를 붙이면 시작 버튼을 건너뜁니다(QA용).

### 휴대폰에서
```bash
node tools/serve.mjs 8000 --lan   # 같은 Wi-Fi 주소를 출력합니다
```
PC와 휴대폰을 같은 Wi-Fi에 두고 출력된 `http://<PC IP>:8000/`을 휴대폰 브라우저로 엽니다. Windows 방화벽이 묻으면 개인 네트워크 허용.
`http://IP` 주소는 보안 컨텍스트가 아니라 Web Locks 대신 localStorage 하트비트로 단일 탭을 지킵니다(Chromium 모바일 에뮬레이션에서 동작 확인). 저장은 휴대폰 브라우저에 따로 쌓이고 PC 진행과 공유되지 않습니다.

## 테스트와 검수

```bash
npm test                                        # node --test: 로직 테스트
node tools/balance_sim.mjs --seeds 4 --hours 34 # 몬테카를로 밸런스 시뮬레이션 (스크립트 플레이어)
node tools/branch_parity.mjs 30                 # 두 갈래로 같은 보스 비교
node tools/serve.mjs 8123 & NODE_PATH=$(npm root -g) node tools/browser_qa.cjs   # Playwright: 42화면 × 해상도별(141회) + 흐름 27개(몰입 화면 포함)
node tools/qa_immersive.cjs 8123                 # 몰입 화면: 보스·던전·탑·균열 × 3해상도
node tools/balance_sim_v4.mjs --seeds 1 --days 14 # v6 진행 곡선 시뮬레이션
node tools/qa_login.cjs 8123                     # 게스트 로그인·클래스 선택·출석·복귀
node tools/qa_v5.cjs 8123                        # 특성·환생·균열
node tools/qa_v6.cjs 8123                        # 도감·업적·칭호·시즌 패스·동료·신화 제작
node tools/qa_v7.cjs 8123                        # 슬롯 강화(이전 안내)·스테이지 지도 × 3해상도
node tools/qa_v8.cjs 8123                        # v8 콘텐츠(쐐기·원정·희귀 정예·제작소·월드 보스) × 3해상도 (docs/qa/screens/v8_*.png)
node tools/mplus_sim.mjs <snap dir>               # 쐐기 단계별 시간 내/초과/실패 (balance_sim_v4 --snap 저장본)
node tools/qa_stage_stable.cjs 8123              # 스테이지 탭이 전투 중에 튀지 않는지(고른 지역·칸 유지)
node tools/qa_v11.cjs 8123                       # 스킬 등급: 뽑기 확률표·등급 상승 결과·스킬 탭/상세 등급·스킬바 색 × 3해상도
node tools/qa_combat_fx.cjs 8123                 # 콤보·치명타·스킬 이펙트·궁극기 컷인 캡처(docs/qa/screens/fx_*.png)·프레임 비용
node tools/qa_mail.cjs 8123                      # 우편함·쿠폰 × 3해상도 (docs/qa/screens/v9_mail_*.png)
node tools/qa_v10.cjs 8123                       # 고유 효과·추출·이식·재련·등급 올리기·각성·프리셋 × 3해상도 (docs/qa/screens/v10_*.png)
node tools/make_coupon.mjs SEONBAE               # 새 쿠폰 코드 → src/data/coupons.js에 넣을 해시 출력
python3 tools/extract_gpt_b.py                  # GPT B 투사체·타격 → fx_*.webp
python3 tools/extract_gpt_c.py                  # GPT C 몬스터 대기·공격·피격·쓰러짐 → mon_M##_<act>.webp
python3 tools/extract_gpt_d.py                  # GPT D 보스 대기·예고·강공·광폭화 → boss_<id>_<act>.webp
python3 tools/extract_gpt_e.py                  # GPT E 동료 대기·공격·기뻐함 → pet_P##_<act>.webp
python3 tools/extract_gpt_f.py                  # GPT F 영웅·전설·신화 장비 22, 스킬 4, 특성 9, 균열 축복 6
python3 tools/extract_gpt_g.py                  # GPT G 금고·서고·시련장·균열 배경
python3 tools/extract_gpt_h.py                  # GPT H 세린 8포즈(찌르기 보정·투명 배경)
python3 tools/extract_gpt_l.py                  # GPT L 고유 효과·추출·이식·재련·등급·각성 아이콘
python3 tools/extract_gpt_i.py                  # GPT I 스테이지 지도 → map_*.webp + 노드 좌표
python3 tools/extract_v5.py                     # pets_6 / icons_v5 → pet_P0x, skill_V## 
python3 tools/extract_assets.py                 # 원화 보드 → assets/runtime (원본 불변)
python3 tools/contact_sheet.py                  # 추출 결과 검수 시트 (docs/qa/assets_*.png)
```
결과: `docs/QA_REPORT.md`(PASS/FAIL/미검증), `docs/qa/`(스크린샷·JSON), `docs/BALANCE_CHANGES.md`, `docs/KNOWN_ISSUES.md`.

## 개발용 가속 세이브
메뉴 → 환경 설정 → 개발 설정(QA용) → "개발 도구 사용"을 켜면 다음을 쓸 수 있습니다.
- 가속 세이브: 첫 보스 직전 / Lv 29·폐광 W10(승급 직전)
- 다음 저장 1회 실패 시뮬레이션, 마지막 접속 13시간 전으로(방치 정산), 입장권 날짜 하루 전으로
- 승급 분기 재전환(개발 설정에서만 허용, 상품화 금지 규칙)

## 구조

```
index.html, styles/app.css      화면 골격·토큰 (docs/handoff/tokens.json 값)
src/main.js                     부팅: 시작/로딩/복구(S20) → 쓰기 잠금 → 저장소 → 루프
src/data/                       balance.js(실험값), content.js(지역·몬스터·보스·스킬·장비)
src/core/                       DOM 없는 게임 로직 (node 테스트 대상)
  combat.js   50ms 고정 틱 전투, 행동 타격 이벤트로 피해·궁극기 게이지·보상
  game.js     상태 머신, 전투↔상태 연결, 저장 트랜잭션, 방치 흐름
  economy.js  골드 강화 비용·상한, 장비·잠금·분해·초과 보관
  autogrow.js 성장 스탯 자동 강화(사냥 골드, 2초마다)·능력치 포인트 자동 분배
  progression.js  EXP·보관 EXP·승급·지역 개방·다음 목표
  offline.js  사냥터 검증과 방치 정산(12시간·75%)
  dungeon.js  입장권(KST 00:00), 입장 트랜잭션, 소탕, 중단 환급
src/platform/save.js            IndexedDB(current/previousGood, 체크섬, revision 충돌), Web Locks 단일 쓰기, localStorage 대체
src/render/                     에셋 로더, Canvas 전투 렌더러
src/ui/                         앱 셸, 22개 화면, 접근성 모달
assets/source/                  인계 원본(보드·배경·원화·SVG) — 수정하지 않음
assets/runtime/                 추출·축소한 실행용 에셋 + sprites.json(피벗·히트박스·trimOffset)
tools/                          서버, 에셋 추출, 폰트 서브셋, 시뮬레이터, 브라우저 QA
docs/handoff/                   인계 사양 사본
```

## 상태 구분 (설계 / 구현 / 검증)

| 영역 | 설계 | 구현 | 검증 |
|---|---|---|---|
| 전투 상태 머신·고정 틱·타격 이벤트 | 완료 | 완료 | 단위 테스트(FPS 15/30/60 동일) |
| 성장 강화 5종 자동 강화(확인 전용 화면), 상한 | 완료 | 완료 | 단위 테스트 4 + 브라우저 |
| 장비 4부위·3등급·강화 +10·분해·잠금·비교·초과 보관 | 완료 | 완료 | 단위 + 브라우저 |
| 스킬 3+1(승급 후 4)+궁극기, 자동 시전 옵션 | 완료 | 완료 | 단위 + 브라우저 |
| 보스 3(예고·강공), 실패 복귀 | 완료 | 완료 | 단위 + 시뮬레이션 + 브라우저 |
| 승급(EXP 보관, 증표, 교관 시련, 2갈래) | 완료 | 완료 | 단위 + 시뮬레이션(갈래 비교) |
| 재료 던전(입장권·소탕·중단 환급) | 완료 | 완료 | 단위 + 브라우저 |
| 방치 정산 | 완료 | 완료 | 단위 + 브라우저(새로고침·연타·저장 실패) |
| 저장 트랜잭션·복구·다중 탭 | 완료 | 완료 | 단위 + 브라우저(Chromium) |
| 22개 화면/상태 | 완료 | 실제 상태 연결 | 브라우저 3해상도 72회 |
| 에셋 추출(일반6·보스3·승급2·아이콘32·배경3·세린 8포즈) | 완료 | 정적 스프라이트로 적용 | 검수 시트 육안 확인 |
| v12 스테이지 페이즈 3·3·4 + 이동 3초(사냥터) | 완료 | 완료 | 단위 테스트 7 + 브라우저(qa_v12) |
| v12 탈것 8종 · 날개 8종(레벨·별·소환·천장) | 완료 | 완료(탈것 4종 실제 그림, 나머지 임시 표현) | 단위 + 브라우저(qa_v12) |
| 연속 프레임 애니메이션 / 리깅 | 인계 명세만 | **미구현** — 키 포즈 전환 + 트윈 | — |
| 실기기(iOS Safari / Android Chrome) | — | — | **미검증** |

## 저장과 그 한계
진행은 이 브라우저의 IndexedDB에만 저장됩니다(실패 시 localStorage, 둘 다 안 되면 저장 안 됨을 표시).
**로컬 저장은 개발 도구로 수정할 수 있어 치트를 막지 못하며, 기기 시계 조작도 완전히 막을 수 없습니다.**
기기 이동은 환경 설정의 내보내기/가져오기 파일로만 가능합니다. 계정·결제·랭킹을 넣기 전에 서버 기준의 재화·시간·지급 멱등성이 필요합니다.

## 공개·배포
선배 지시로 GitHub Pages에 배포합니다: https://hyuny0219.github.io/asteria/ (`main` 푸시 시 갱신).
