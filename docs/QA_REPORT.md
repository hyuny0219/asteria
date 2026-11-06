# 검수 결과 (03_QA 체크리스트)

환경: Linux 컨테이너, Node 22 `node --test`, Playwright Chromium(헤드리스). **실제 iOS Safari / Android Chrome은 미검증.**
근거: `npm test`(48/48 통과: core·rewards·v4), `docs/qa/browser_results.json`(화면 114/114 · 32종, 흐름 13/13), `tools/qa_login.cjs`(9/9: 게스트 로그인·클래스 선택·출석·복귀), `docs/qa/balance_sim.txt`, `docs/qa/branch_parity.json`, `docs/qa/screens/*.png`(32화면 × 390×844·360×700·412×915).

## 기능
| 항목 | 결과 | 근거 |
|---|---|---|
| 첫 60초 안 골드 강화, 첫 10분 안 첫 보스 | PASS | 시뮬: 첫 강화 0.2분, 첫 보스 도전 3.1분 |
| 일반 사냥 → 보스 실패 → 자동 복귀 | PASS | 단위 "boss failure", 브라우저 defeat |
| 15/30/60FPS 같은 결과(seed 고정) | PASS | 단위 "FPS invariance" |
| 다단/광역 궁극기 충전 상한 | PASS | 단위 "ult caps" |
| 공속·치명 상한 초과 구매 불가, 재화 음수 없음 | PASS | 단위 "upgrade caps" |
| ×10/MAX 수량·비용·차감·부족액 | PASS | 단위 "×10/MAX" |
| 장착/잠금 일괄 분해 불가, 80% 내림, 중복 환급 없음 | PASS | 단위 "dismantle", 브라우저 dismantle |
| 장비 가득/방치 20개 초과 시 보관·전환 표시 | PASS | 단위 "overflow conversion", offline 정산 화면 |
| 스킬 4 + 궁극기 1, 미해금 칸 조건 표시 | PASS | 브라우저 skills (승급 해금 칸) |
| Lv 30 EXP 보관 → 승급 → 순차 적용, Lv 35 처리 | PASS | 단위 "pending EXP" |
| 증표 부족/보스 미처치/시련 실패 이유·바로가기 | PASS | 단위 "checklist", 브라우저 promotion |
| 자동 시련만으로 승급 가능, 실패 시 재료 차감 없음 | PASS | 단위 "trial", 시뮬(자동 정책으로 승급) |
| 두 갈래 동일 보스 클리어, 한쪽 압도 없음 | PASS | branch_parity: 둘 다 100%, 43.7초 vs 49.4초 |
| 던전 소탕 ≤ 최고 단계, 입장권·날짜 경계·9개 상한 | PASS | 단위 "dungeon" |

## 저장·보상
| 항목 | 결과 | 근거 |
|---|---|---|
| 경과 0초/1h/12h/24h/시계 역행 | PASS | 단위 offline 케이스 |
| 24h 경과 → 12h 지급, 손실 시간 표시 | PASS | 단위 + 브라우저 offline(13h → 12h) |
| ×1·일시 버프 제외·75%, 반올림 일관 | PASS | 단위 offline |
| 검증 안 된 보스/새 지역으로 수익 급등 없음 | PASS | 단위 "verifier" |
| 더블탭/새로고침/창 닫기/두 탭 중복 지급 없음 | PASS | 브라우저 흐름 4종(연타 1회 지급, 새로고침 같은 claimId, 두 번째 탭 차단) |
| 숨김 복귀 보상 + 누적 dt 중복 적용 없음 | PASS | 단위 + 브라우저 "hidden → visible" |
| 소비 직후 종료·세이브 손상·마이그레이션·이전 정상본 복구 | PASS(부분) | 단위 checksum/migrate/validate, 복구 화면 S20. 실제 강제 종료는 Chromium 탭 닫기로만 |
| 저장 거부/용량 부족 오류 표시, '저장됨' 오표시 없음 | PASS(시뮬레이션) | 브라우저 saveerror·"failed save spends nothing". 실제 QuotaExceeded 미검증 |
| 로컬 저장을 보안 완료로 주장하지 않음 | PASS | README·설정 화면 문구 |

## UI·아트
| 항목 | 결과 | 근거 |
|---|---|---|
| 3해상도 가로 넘침 없음, 중요 버튼 접근 | PASS | 72/72 |
| 버튼 48px, 본문 16px, 보조 14px | **의도적 미준수** | 선배 요청("큼직해서 불편")으로 축소: 본문 14px, 보조 13px(표 내부 일부 12px), 주 버튼 40px, 칩·탭 36px, 하단 탭 50px. 브라우저 검수의 작은 터치 대상 기준은 32px 미만으로 바꿔 0건 |
| 200% 텍스트 접근(스크롤 허용) | PASS(CSS) | 브라우저 흐름. OS 글꼴 확대 미검증 |
| 모달 포커스·키보드·음소거·감소된 모션 | PASS | 포커스 트랩/Escape/복귀, 설정 화면 |
| 등급 흑백 구분(배지·이름) | PASS | I/II/III 표시 + 등급명 |
| 접지점·축척·윤곽 품질 | PASS(정적) | `docs/qa/assets_*.png`. 애니메이션 프레임은 없음(KNOWN_ISSUES) |
| PNG 시안과 차이 목록 | PASS | 아래 |
| 닫힘·백그라운드·저전력 복귀 | 부분 | visibility/pagehide 처리. 저전력 실기기 미검증 |
| 실제 iOS Safari / Android Chrome | **미검증** | 장비 없음 |

## v2 추가
| 항목 | 결과 |
|---|---|
| 모든 캐릭터 성인, 도트/치비 잔재 없음 | PASS |
| 일러스트 모드 ↔ 전투 모드 전환 시 전투·재화·쿨타임 연속 | PASS(같은 Game 상태, 표시만 전환) |
| 보스 진입 시 실전투 표시, 결과 후 이전 모드 복원 | PASS |
| 세린 기본/기사/집행자 얼굴·나이·머리색 동일성 | PASS(인계 원화 그대로 사용) |
| 생성 원본 vs 분리 에셋·애니 시트 구분 | PASS(`assets/source` vs `assets/runtime`, 애니 시트는 미제작 명시) |
| imageSmoothingEnabled=true, 고해상도 축소·알파 가장자리 | PASS |
| 주색/등급색 대비, 일러스트 위 스크림 | PASS |
| 등급 표시가 심의 등급으로 오해되지 않음 | PASS(I/II/III + 일반/고급/희귀) |

## PNG 시안 대비 실제 UI 차이 (의도)
1. 광고 +25% 버튼 제거(실광고 미포함 범위).
2. 카드형 스크롤 대신 08 명세 높이표(52/40/220/64/56/312/56) 고정 배치.
3. 보조 텍스트 12px → 14px(03_QA 기준).
4. 토스트를 하단에서 상단으로(모달 버튼 가림 방지), 최대 2개.
5. 장비 타일의 장착·잠금 표시를 이름 위 오른쪽으로 이동.
6. 소환 화면은 "확장 예정" 비활성.
7. 승급 후 전투는 정적 원화 + 트윈(전용 시트 없음).

## v4 (기획서 전체 시스템) 화면 검수
| 화면 | 결과 | 근거 |
|---|---|---|
| 클래스 선택(4종, 승급 트리 미리보기) | PASS | classpick × 3해상도, qa_login(마법사 선택 → 궁극기 메테오 표시) |
| 장비 뽑기 / 스킬 뽑기(확률 공개·천장·소환 레벨) | PASS | gacha, gachaskill, gachaResult(11회, 저장 후 공개) |
| 일일 미션 | PASS | missions |
| 능력치 포인트 | PASS | statpoints |
| 각인 2칸 | PASS | runes |
| 장비 8부위·6등급·세트·옵션·+15 | PASS | inventory, compare, enhance |
| 던전 3종·시련의 탑·주간 레이드 | PASS | dungeon, tower, towerResult, raidResult |
| 2·3차 승급 | PASS | promotion(2차), promoPlay, quest(3차 체크리스트) |
| 새 지역 7곳 그림 | **임시** | 기존 그림 색조 변경(KNOWN_ISSUES) |

## v4 그림 적용 검수
| 항목 | 결과 | 근거 |
|---|---|---|
| 새 몬스터 14종 왼쪽(주인공 방향), 접지·비행 위치 | PASS(정적) | `docs/qa/assets_monsters_v4.png`, 전투 캡처 `art_*_390x844.png` |
| 새 보스 7종 + 탑 수호자 잘림 없음, 보스 높이 상한 | PASS | `assets_bosses_v4.png`, `art_boss_B04/B06/B09_390x844.png` |
| 지역 4–10·탑 배경, 바닥선(groundRatio) | PASS | `assets_bgs_v4.png`(노란 선) |
| 2·3차 승급 외형 16종, 1차와 같은 키·얼굴 | PASS | `assets_tiers_v4.png`, `promotion_390x844.png`(지금 / 다음 외형) |
| 새 스킬 24·각인 8·탑/레이드 문장 아이콘 | PASS | `assets_skills_v4.png`, `art_skills_mage_390x844.png` |
| 단위 테스트 / 브라우저 / 로그인 | 56/56 · 114/114 화면, 13/13 흐름 · 10/10 | `npm test`, `tools/browser_qa.cjs`, `tools/qa_login.cjs` |

## v4 3부 (자동 성장·키 포즈) 검수
| 항목 | 결과 | 근거 |
|---|---|---|
| 자동 강화: 다섯 스탯 고르게, 음수 골드 없음, 상한 준수, 예약 골드 유지 | PASS | tests/autogrow.test.mjs |
| 성장 탭 확인 전용(버튼 없음), 값이 제자리 갱신 | PASS | 브라우저 main_390x844 / main_360x700 |
| 저장 실패 시 소비 없음 (상점 구매로 교체) | PASS | browser_qa 흐름 |
| 마법사·궁수·도적 8 키 포즈, 공격 순간 포즈 | PASS(정적 확인) | docs/qa/screens/pose_*_390x844.png |
| 실기기 | 미검증 | — |

## v5 1부 (특성·환생·균열) 검수
| 항목 | 결과 | 근거 |
|---|---|---|
| 특성: 승급 전 잠금, 포인트 공식, 줄 관문, 랭크 상한, 자기 클래스 트리만 | PASS | tests/v5.test.mjs |
| 핵심 특성 전투 효과 (이중 유성 추가 타격, 재기 생존, 그림자 일격) | PASS | tests/v5.test.mjs |
| 프리셋 분리, 초기화 1일 1회 무료 후 골드 | PASS | tests/v5.test.mjs |
| 환생: Lv 100 조건, 초기화/유지 항목, 승급 잠금 해제 유지, 강화 배율, 기억의 가속 | PASS | tests/v5.test.mjs |
| 균열: B03 잠금, 1일 2회, 축복 3택(중복 없음, 결정적), 보상 1회, 30층 완주, 주간 저주 | PASS | tests/v5.test.mjs |
| 균열 저장 후 다시 열면 이어하기, 포기 시 보상 | PASS | tests/v5.test.mjs (Game + MemorySaver) |
| 스키마 3 → 4 이전 | PASS | tests/v5.test.mjs |
| 특성 화면 탭으로 랭크 올리기, 넘침 없음 | PASS | tools/qa_v5.cjs, `talents_390x844.png`, `talents_360x700.png` |
| 환생 화면 설명 + 빨간 확인 후에만 적용 | PASS | `rebirth_390x844.png`, `rebirth_360x700.png` |
| 균열 입장 → 층 클리어 → 축복 선택 → 마치기 → 보상 | PASS | `rift_*.png`, `riftBless_*.png`, `riftResult_*.png` |
| 단위 테스트 / 브라우저 / 로그인 / v5 | 72/72 · 123/123 화면(35종), 13/13 흐름 · 10/10 · 14/14 | `npm test`, `tools/browser_qa.cjs`, `tools/qa_login.cjs`, `tools/qa_v5.cjs` |
| 실기기 | 미검증 | — |

## v5 2부 (도감·업적·칭호·시즌 패스·동료·신화 제작) 검수
| 항목 | 결과 | 근거 |
|---|---|---|
| 도감 단계 10/100/1000·보스 1/10/50, 장비 도감 중복 없음, 보너스 작음 | PASS | tests/meta.test.mjs |
| 업적 32개 판정·1회 수령·칭호 획득·장착 | PASS | tests/meta.test.mjs |
| 시즌 패스 XP·레벨·1회 수령·처치 XP 일일 상한·28일 시즌 초기화·30레벨 칭호 | PASS | tests/meta.test.mjs |
| 동료 부화(6종 균등)·중복→조각→별·먹이→레벨·오라·전투 주기 공격 | PASS | tests/meta.test.mjs |
| 신화 제작 잠금·정확한 비용·저장 실패 시 소모 없음 | PASS | tests/meta.test.mjs (Game + MemorySaver) |
| 스키마 4 → 5 이전(장비 도감·보스 도감 채움) | PASS | tests/meta.test.mjs |
| 부화 8회 → 동행, 업적 모두 받기, 칭호 장착 후 상단 표시, 패스 1레벨 수령, 신화 제작, 전투 중 동료 타격 | PASS | tools/qa_v6.cjs (32/32), `pets_*`, `petHatch_*`, `titles_*`, `pass_*`, `craft*_*`, `battle_pet_*` |
| 단위 테스트 / 브라우저 / 로그인 / v5 / v6 | 79/79 · 141/141 화면(41종), 13/13 흐름 · 10/10 · 14/14 · 32/32 | `npm test`, `tools/browser_qa.cjs`, `tools/qa_login.cjs`, `tools/qa_v5.cjs`, `tools/qa_v6.cjs` |
| 실기기 | 미검증 | — |

화면을 보고 고친 것:
- 동료가 영웅 왼쪽 위 화면 끝에 잘려 보였습니다. 영웅 앞 땅 위로 옮겼습니다(나는 동료는 위에 뜹니다).
- 신화 제작의 부위 칩 7개가 가로 스크롤에 숨어 반지가 안 보였습니다. 칩을 줄바꿈하게 바꿨습니다.

## v5 3부 (남은 코드 과제) 검수
| 항목 | 결과 | 근거 |
|---|---|---|
| 핵심 특성 나머지 6종 + 그림자 일격 전투 효과(반격 강화·광폭·저주 강화·화살비 강화·야수 강화·환영) | PASS | tests/capstones.test.mjs (7) |
| 투사체(마법사 별빛 탄·궁수 화살·도적 스킬 단검) 150ms 비행, 착탄 시 숫자·불꽃 | PASS(정적 확인) | `proj_mage_390x844.png`, `proj_archer_390x844.png`, `proj_rogue_390x844.png` |
| 교관 분신 흑백을 캐시 비트맵으로 (프레임마다 filter 없음) | PASS | `trial_cached_390x844.png` |
| 균열 축복·저주 HUD 칩 | PASS | app.js `renderRiftChips`, qa_v5 균열 화면 |
| 특성 트리 탭 아이콘(트리별) | PASS | qa_v5 `talents_*.png` |
| Web Locks 없는 브라우저: localStorage 하트비트로 두 번째 탭 대기 → 가져오기 → 첫 탭 정지 | PASS | browser_qa 흐름 4b |
| aria-live: 보스 처치·영웅 쓰러짐·레벨 업·희귀 이상 획득(1.5초 제한) | PASS(코드) | app.js `announce`. 스크린 리더 실청취 미검증 |
| 불씨 새끼용 날개 보존 재추출 | PASS(육안) | `assets/runtime/pet_P02.webp`, 매트 `pets_6_alpha.png` |
| 단위 테스트 / 브라우저 / 로그인 / v5 / v6 | 86/86 · 141/141 화면(41종), 14/14 흐름 · 10/10 · 14/14 · 32/32 | `npm test`, `tools/browser_qa.cjs`, `tools/qa_login.cjs`, `tools/qa_v5.cjs`, `tools/qa_v6.cjs` |
| 실기기 | 미검증 | — |

그림이 필요한 항목(승급·몬스터·동료 포즈, 엘레나 빛, 영웅+ 아이콘, 금고·서고 배경, 트리 문장)은 `docs/GPT_REQUEST.md`로 요청 대기입니다.

## v6 몰입 화면·레벨 속도 (2026-11-06)
| 항목 | 결과 | 근거 |
|---|---|---|
| 보스·던전·탑·균열 몰입 화면 3해상도(390×844/360×700/412×915), 하단 패널·탭 숨김, 넘침 0, 작은 터치 0 | PASS | `tools/qa_immersive.cjs` 13/13 (포기 → 사냥 복귀 포함), `docs/qa/screens/immersive_*` |
| 전체 회귀 | PASS | npm test 86/86, browser_qa 141/141 화면(42종)·흐름 27/27(몰입 13 포함), qa_login·qa_v5·qa_v6 실패 0, qa_a01·qa_a02 오류 없음 |
| 레벨 속도 목표 (Lv30 6h · Lv60 2.5d · Lv90 7d · Lv100 10d) | PASS(시뮬) | `docs/qa/balance_sim_v6.txt` |
