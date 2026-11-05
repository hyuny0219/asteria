# assets/runtime

`python3 tools/extract_assets.py`가 `assets/source/`(인계 원본, 수정 금지)에서 만든 실행용 에셋입니다.
직접 수정하지 말고 스크립트를 다시 실행하세요. 피벗·trimOffset·히트박스·원본 영역은 `sprites.json`에 있습니다.
폰트는 `tools/subset_font.py`로 만든 Noto Sans KR 서브셋(OFL, `fonts/OFL.txt`)입니다.

v4 생성 그림: `python3 tools/extract_v4.py`(클래스 3종·1차 갈래·장비/재료 아이콘) 다음 `python3 tools/extract_v4b.py`(몬스터 M07–M20, 보스 B04–B10·탑 수호자, 배경 forest~void·tower, 2·3차 외형 `hero_promo_<갈래>_t2/_t3`, 스킬·각인 아이콘 `skill_K00`–`K35`). 원본은 `assets/source/generated/`(SOURCES.md), 검수 시트는 `python3 tools/contact_sheet_v4.py`.

## 인계 v4(GPT) 클래스 그림 — 현재 사용
`python3 tools/extract_gpt_v4.py`가 엘레나·리라·녹스를 선배가 준 인계 v4 그림(`assets/source/handoff_v4/classes/`)에서 다시 만듭니다
(기본 외형, 1차 갈래, 8 키 포즈, 얼굴·카드·일러스트, 무기 아이콘 I40–I48, 스킬 아이콘 G00–G23).
2·3차 외형은 인계 v4 외형을 참고해 생성한 `assets/source/generated/tier23_<cls>_gpt.png`(+ `_alpha.png` 매트)에서 잘라 씁니다.
같은 스프라이트 키를 덮어쓰므로 이전 생성 클래스 그림(`*_board.png`, `poses/`, `tier23_<cls>.png`)은 원본만 남고 게임에는 쓰지 않습니다.
인계 v4의 구현 지시·수치·스킬 이름은 따르지 않았습니다(그림만 참고).

스킬 아이콘 매핑(인계 v4 아이콘 → 우리 스킬, 이름은 그대로):
- 마법사: 성광탄→파이어볼 G00, 별비→메테오 G01, 성운 장막→눈보라 G02, 원소 공명→연쇄 번개 G04, 심연 낙인→생명 흡수 G05, 장막→마나 실드 G06, 저주→저주 G07 (서리 고리는 K01 유지, 천구 붕괴 G03 미사용)
- 궁수: 관통 사격→관통 사격 G08, 쌍연사→멀티샷 G09, 월광 일섬→저격 G11, 정밀 조준→정조준 G12, 가시 덫→야수 소환 G13 (후방 도약·무리 사냥·화살비는 K 유지; G10·G14·G15 미사용)
- 도적: 쌍아 베기→그림자 강습 G16, 그림자 찌르기→독칼 G17, 연막 보법→그림자 걸음 G18, 적월 난무→천 개의 칼날 G19, 급소 처형→처형 G20, 거울 분신→환영 분신 G21, 회피→연막 G22, 약점 노출→급소 찌르기 G23
무기: 직업별 무기는 마도서·활·쌍단검(일반 / 고급 / 희귀 이상). 전사는 검 그대로. 이미 가진 장비는 원래 그림 그대로 보입니다.

v5 2부: `pet_P01–P06.webp`(동료 6종, `pets_6.png`)와 `skill_V00–V15.webp`(문장 16개, `icons_v5.png`, 96px)는 `tools/extract_v5.py`로 만듭니다. 메타데이터는 `sprites.json`의 `pets`와 `skills`에 있습니다.

## GPT A01 승급 포즈 (tools/extract_gpt_a01.py)
`hero_pose_promo_<branch>_<pose>.webp` (sprites.json `hero.pose_promo_<branch>_<pose>`), 1차 승급 외형의 8 키 포즈.
원본: `assets/source/gpt_a01/poses_<branch>1.png` (1536×1024 RGBA, 4×2, idle·step·windup·contact·recovery·hit·skill·victory → idle·step·anticipation·thrust·recovery·hit·cast·victory).
시트당 배율 1개, 발 피벗은 골반 열 기준. 위자드는 원본 재업로드 후 같은 스크립트를 다시 실행.
