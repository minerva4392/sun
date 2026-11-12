# 카운트다운 클럽 온라인

## 실행

Node.js 20 이상이 필요합니다.

```sh
npm.cmd install
npm.cmd start
```

PowerShell에서 `npm` 실행이 정책으로 차단되는 경우 `npm.cmd`를 사용하세요.

브라우저에서 `http://localhost:3000`을 열고 방을 만드세요. 같은 Wi-Fi의 다른 컴퓨터는 방장 컴퓨터의 로컬 IP 주소로 접속하면 함께 플레이할 수 있습니다. Windows 방화벽이 처음 접속을 물으면 Node.js의 사설 네트워크 통신을 허용해야 합니다.

## Vercel 배포

GitHub 저장소 `minerva4392/sun`을 Vercel 프로젝트로 가져오면 루트의 정적 페이지와 `api/ws.js` WebSocket 함수를 함께 배포합니다. 배포된 HTTPS 주소에서 세 명이 접속해 방 코드를 공유하세요. 브라우저는 자동으로 WSS 연결을 사용합니다.

Vercel WebSocket 함수는 연결이 서로 다른 인스턴스에 배정될 수 있습니다. 현재 방 상태는 서버 메모리에 있으므로 인스턴스가 나뉘거나 재시작되면 방이 동기화되지 않을 수 있습니다. 안정적인 다중 인스턴스 운영에는 Redis 같은 공유 상태 저장소 연결이 필요합니다.
