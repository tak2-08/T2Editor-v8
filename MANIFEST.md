# T2Editor v8 배포본 매니페스트

**상태: EOL (지원 종료) — 이 계열의 모든 판본**
판본 6건 · 출처 시점 2026-09-27 · 배포 API `https://dsclub.kr/api/t2editor/version/index.php?action=list`

릴리즈 노트에 실리는 배포 설명 전문을 옮긴 기록이다.

---

## 1. v8.0.0

- **상태: EOL**
- 배포일: 2025-12-30
- 저장소 표제: T2Editor 8.0.0
- 브랜치: `releases/v8.0.0` · 태그: `v8.0.0`
- ZIP: `8.0.0.zip` (1264197 bytes)
- sha256: `2327d23b95b68f6d48a7b0459575b3311dd1cefa598cdd43a5941476e7b2ad8a`
- 배포 시점 유효 라이선스: **2.0.0**
- 라이선스 원본 위치: 배포본 안 `readme.txt`
- readme.txt: 포함 (sha256 `2bc8aabd0d165e65ffc415f2679b0d886e1fd54286f488582150d4152d57094e`)
- 배포 API 원본: <https://dsclub.kr/api/t2editor/version/index.php?action=download&version=8.0.0&file=0>

### 배포 설명

```text
- t2_css_min.php와 t2_js_min.js를 통해 core.css, dark.css를 비롯한 플러그인들의 css파일들, core.js, utils.js, toolbar.js, 플러그인 js파일들을 min.css, min.js처럼 압축로딩할 수 있는 기능을 추가하였습니다.사용법:true/false를 통해 css압축 옵션과 js압축 옵션을 킬 수 있음 (기본값은 false)사용 대상(권장): 서버 컴퓨터의 성능이 CPU n100 이상이면서 메모리가 4~8GB 이상인 시스템 google PageSpeed Insights 결과(모바일 기준):압축 적용 전 성능: 60~65적용 후 성능: 70~75- 접근성 향상기존: 70~개선:90~- 권장사항:기존: 7~80개선: 90~​
```

---

## 2. v8.0.1

- **상태: EOL**
- 배포일: 2026-01-04
- 저장소 표제: T2Editor 8.0.1
- 브랜치: `releases/v8.0.1` · 태그: `v8.0.1`
- ZIP: `8.0.1.zip` (1264168 bytes)
- sha256: `971d2a72dd6284e92d702b244b3e60b625a0c27cc2fc5dd925795cfa4be231db`
- 배포 시점 유효 라이선스: **2.0.0**
- 라이선스 원본 위치: 배포본 안 `readme.txt`
- readme.txt: 포함 (sha256 `c4692386a73bb4760802d308af62ed4d417d3d75b6b6f160bdb89cdfc09c8fd2`)
- 배포 API 원본: <https://dsclub.kr/api/t2editor/version/index.php?action=download&version=8.0.1&file=0>

### 배포 설명

```text
T2Editor 로고 수정(개선)

테이블(블록) 플러그인이 작동하지 읺는 문제를 패치함 (t2editor/plugin/table/table.js)

- 툴 바에서 테이블 블록 생성 버튼 클릭 후 뜨는 모달에서 삽입 버튼을 눌러도 추가되지 않는 문제를 해결하였습니다.

​
```

---

## 3. v8.1.0

- **상태: EOL**
- 배포일: 2026-01-05
- 저장소 표제: T2Editor 8.1.0
- 브랜치: `releases/v8.1.0` · 태그: `v8.1.0`
- ZIP: `8.1.0.zip` (1264438 bytes)
- sha256: `1f570e04f8744f48608e5bee6a8f5105f8527a484e01cf673dc777f03d9be2be`
- 배포 시점 유효 라이선스: **2.0.0**
- 라이선스 원본 위치: 배포본 안 `readme.txt`
- readme.txt: 포함 (sha256 `ede004cf6944c6dd9da30b43b2062baa4c3d523c7210608bb694ce7c9a585faf`)
- 배포 API 원본: <https://dsclub.kr/api/t2editor/version/index.php?action=download&version=8.1.0&file=0>

### 배포 설명

```text
검색 플러그인 개선 (t2editor/plugin/search/search.js)- 기존 검색 옵션 토글 기능 변경(에디터 내 콘텐츠 검색 on/off -&gt; T2Search 검색 on/off)(T2Search가 켜져있으면 검색창 아래에 powered by T2Search 로 출력되며, off 시 powered by T2Editor로 변경됩니다, 설정값은 브라우저에 자동 저장)- 검색한 콘텐츠 일괄 다른 텍스트로 변경 기능 추가에디터 하단 버전 텍스트 색상 더 밝게 (눈에 덜 띄게 수정, #666 -&gt; #7a7a7a) (t2editor/editor.lib.php)​
```

---

## 4. v8.1.1

- **상태: EOL**
- 배포일: 2026-01-05
- 저장소 표제: T2Editor 8.1.1
- 브랜치: `releases/v8.1.1` · 태그: `v8.1.1`
- ZIP: `8.1.1.zip` (1264446 bytes)
- sha256: `23630cd3d073b9b81526d031cf22830e3bdef956800d8eb1d6ecd37ec613abfa`
- 배포 시점 유효 라이선스: **2.0.0**
- 라이선스 원본 위치: 배포본 안 `readme.txt`
- readme.txt: 포함 (sha256 `485738e677e6a5a58026ea083c3b637d85815eb091a82f76f195ac425c3d3196`)
- 배포 API 원본: <https://dsclub.kr/api/t2editor/version/index.php?action=download&version=8.1.1&file=0>

### 배포 설명

```text
ai 플러그인 작동 불가 해결 (dsclub.kr과의 연결 문제)(t2editor/plugin/ai/ai.js, t2editor/plugin/ai_rerrange/ai_rerrange.js)​
```

---

## 5. v8.1.2

- **상태: EOL**
- 배포일: 2026-03-26
- 저장소 표제: T2Editor 8.1.2
- 브랜치: `releases/v8.1.2` · 태그: `v8.1.2`
- ZIP: `8.1.2.zip` (1265646 bytes)
- sha256: `dafd47b0fc21be05d6136f334b0584f69d90c3dab39e532620d51cb256546bfe`
- 배포 시점 유효 라이선스: **2.0.0**
- 라이선스 원본 위치: 배포본 안 `readme.txt`
- readme.txt: 포함 (sha256 `1bacc0e40e387fe0de7916fa763caaae1a4879fb5d825284f0421908697e8a7c`)
- 배포 API 원본: <https://dsclub.kr/api/t2editor/version/index.php?action=download&version=8.1.2&file=0>

### 배포 설명

```text
ai 플러그인 작동 불가 해결 (dsclub.kr과의 연결 문제)(t2editor/plugin/ai/ai.js, t2editor/plugin/ai_rerrange/ai_rerrange.js, dsclub.kr서버)작성중이던 게시글 자동 저장 불가 오류 해결​
```

---

## 6. v8.2.0

- **상태: EOL**
- 배포일: 2026-03-26
- 저장소 표제: T2Editor 8.2.0
- 브랜치: `releases/v8.2.0` · 태그: `v8.2.0`
- ZIP: `8.2.0.zip` (1268909 bytes)
- sha256: `47f4748278c53ab31eb1584382f8a76b5514cf3bcde1f73ea3783f87710854b5`
- 배포 시점 유효 라이선스: **2.0.0**
- 라이선스 원본 위치: 배포본 안 `readme.txt`
- readme.txt: 포함 (sha256 `948090888af4b587ca090cde7c50257780bd63337b2da33c0d3615078907f452`)
- 배포 API 원본: <https://dsclub.kr/api/t2editor/version/index.php?action=download&version=8.2.0&file=0>

### 배포 설명

```text
1. T2Editor 외의 에디터로 작성한 콘텐츠에 대한 마이그레이션 지원editor.lib.php의 ‘마이그레이션 옵션’에서 아래와 같이 선택가능.
'auto' : 묻지 않고 즉시 T2Editor 형식으로 자동 변환 'prompt' : 타 에디터 콘텐츠 감지 시 변환 여부 팝업 표시​false : 감지/변환 비활성화 (기본값)
2. T2Editor 로고 디자인 수정- 'T2'에 볼드 효과 추가.
```
