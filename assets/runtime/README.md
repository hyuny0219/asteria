# assets/runtime

`python3 tools/extract_assets.py`가 `assets/source/`(인계 원본, 수정 금지)에서 만든 실행용 에셋입니다.
직접 수정하지 말고 스크립트를 다시 실행하세요. 피벗·trimOffset·히트박스·원본 영역은 `sprites.json`에 있습니다.
폰트는 `tools/subset_font.py`로 만든 Noto Sans KR 서브셋(OFL, `fonts/OFL.txt`)입니다.

v4 생성 그림: `python3 tools/extract_v4.py`(클래스 3종·1차 갈래·장비/재료 아이콘) 다음 `python3 tools/extract_v4b.py`(몬스터 M07–M20, 보스 B04–B10·탑 수호자, 배경 forest~void·tower, 2·3차 외형 `hero_promo_<갈래>_t2/_t3`, 스킬·각인 아이콘 `skill_K00`–`K35`). 원본은 `assets/source/generated/`(SOURCES.md), 검수 시트는 `python3 tools/contact_sheet_v4.py`.
