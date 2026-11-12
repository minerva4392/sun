# 카운트다운 클럽 온라인

## 실행

Node.js 20 이상이 필요합니다.

```sh
npm.cmd install
npm.cmd start
```

PowerShell에서 `npm` 실행이 정책으로 차단되는 경우 `npm.cmd`를 사용하세요.

브라우저에서 `http://localhost:3000`을 열고 방을 만드세요. 같은 Wi-Fi의 다른 컴퓨터는 방장 컴퓨터의 로컬 IP 주소로 접속하면 함께 플레이할 수 있습니다. Windows 방화벽이 처음 접속을 물으면 Node.js의 사설 네트워크 통신을 허용해야 합니다.

## 인터넷에 공개 배포

저장소를 GitHub에 올리고 Render에서 `render.yaml`을 이용해 Web Service로 배포하면 HTTPS 주소가 생깁니다. 그 주소를 세 명이 각자 열고, 방장이 공유한 방 코드로 참가합니다. Render는 WebSocket 연결을 지원하고, 페이지는 HTTPS에서 자동으로 WSS를 사용합니다.

방 상태는 서버 메모리에 보관합니다. 서버가 재시작되면 진행 중인 방은 사라지므로, 이 버전은 영구 방 저장이나 계정 기능을 제공하지 않습니다.
