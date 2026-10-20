# SIRIUS Build Dashboard

LENS 및 LENS Installer의 로컬 빌드·개발 기록 관리 도구입니다. 제품 저장소와 별도로 관리합니다.

처음 내려받은 PC에서는 `scripts/build-dashboard/settings.example.json`을 같은 폴더의 `settings.json`으로 복사한 뒤 실제 저장소 경로와 Notion 연결 정보를 입력하세요. Node.js, Git 및 Windows PowerShell이 필요합니다. 개인 설정과 작업 로그는 Git에 포함하지 않습니다.

- 실행: `Open Build Dashboard.cmd`
- 접속: http://127.0.0.1:4178/
- 설정: `scripts/build-dashboard/settings.json`의 `lensPath`, `installerPath`, `lensArchivePath`
- 작업 기록: 이 저장소의 `artifacts/dashboard` (Git 제외)
- 로그인 자동 실행: `scripts/start-build-dashboard.ps1 -RegisterStartup -NoBrowser`
- 서버 재시작: `scripts/start-build-dashboard.ps1 -Restart -NoBrowser`
- 상세 사용법: [대시보드 설명](scripts/build-dashboard/README.md)

기록 안의 과거 로그·요청문에는 이전 저장 경로가 남을 수 있습니다. 이는 과거 실행 당시의 정보입니다.
LENS 최신 배포본은 LENS 저장소의 `publish`, 인스톨러 최신 배포본은 인스톨러 저장소의 `publish`에 유지합니다.

## 계정과 기록 편집

- 제품명 옆 연결 아이콘에서 로컬 Git 저장소를 선택합니다. 폴더 선택 또는 전체 경로 입력 후 `폴더 검사` → `연결 저장` 순서입니다.
- 저장소 루트·커밋·제품별 프로젝트 파일·게시 스크립트·버전 정보를 검사합니다. 연결만으로 빌드나 커밋을 실행하지 않습니다. 선택한 저장소의 스크립트를 신뢰할 수 있어야 합니다.
- 연결 경로는 `scripts/build-dashboard/settings.json`에 저장하며 즉시 빌드·Git 상태·버전 조회에 적용합니다. 작업/로그인 중에는 연결을 변경할 수 없습니다.
- 기존 작업의 경로는 유지합니다. 이전 저장소에서 수행한 작업의 Notion 재시도는 해당 원본 저장소를 다시 연결한 뒤 실행하세요.

- 상단 Codex 메뉴에서 CLI 로그인 계정, 남은 사용량 비율과 초기화 시간을 조회합니다. 조회는 모델을 실행하지 않으며 1분간 캐시합니다. 정확한 잔여 토큰 개수를 뜻하지 않습니다.
- 계정 변경은 공식 로그인 링크에서 직접 완료합니다. 같은 인증 저장소를 사용하는 CLI/도구에도 영향을 줄 수 있습니다. 작업 중에는 변경할 수 없으며 로그인 중에는 새 작업을 시작하지 않습니다.
- 로컬 빌드는 Codex 사용량과 무관합니다. 조회 실패 시 사용량을 0으로 간주하지 않습니다.
- 배포 기록의 `현재 버전`은 제품 소스에 설정된 버전과 일치한다는 뜻입니다. 빌드 기록은 제품별 최근 성공 빌드에만 태그를 표시하고, 그 빌드가 현재 소스 버전과 같을 때 `현재 버전`도 표시합니다. 배포 완료 여부를 뜻하지 않습니다.
- 배포 기록은 버전 높은 순/낮은 순, 빌드 기록은 실행 날짜 최신 순/오래된 순으로 정렬할 수 있습니다. 오른쪽 연필 아이콘으로 제목·설명을 수정합니다.
- `수정`에서는 제목·설명만 변경합니다. 버전, 커밋, 원본 로그, 파일 경로와 Notion은 변경하지 않습니다.
- 수정 내용은 `artifacts/dashboard/record-edits.json`에 별도로 보존되어 재시작 후에도 유지됩니다. 이 파일도 작업 기록과 함께 백업하세요.
