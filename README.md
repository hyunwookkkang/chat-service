# chat-service

기업용 **실시간 CS 상담 및 자동 배정 시스템**의 백엔드입니다. 고객이 상담을 요청하면 온라인 상담사 중 가장 여유 있는 사람에게 자동으로 배정되고, WebSocket으로 실시간 채팅이 이루어집니다. 상담사가 모두 바쁠 때는 대기열로, 상담사가 갑자기 연결이 끊기면 자동 재배정으로 처리합니다.

인증(JWT Access/Refresh), 실시간 채팅(Socket.io), 자동 배정, 대기열, 재배정, 관리자 대시보드까지 CS 시스템의 핵심 흐름을 담고 있습니다.

![NestJS](https://img.shields.io/badge/NestJS-E0234E?logo=nestjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Socket.io](https://img.shields.io/badge/Socket.io-010101?logo=socketdotio&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?logo=postgresql&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-2D3748?logo=prisma&logoColor=white)
![JWT](https://img.shields.io/badge/JWT-000000?logo=jsonwebtokens&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=white)

---

## 기술 스택

- **런타임/프레임워크**: Node.js 20, NestJS 10, TypeScript
- **실시간 통신**: Socket.io (`@nestjs/websockets`, `@nestjs/platform-socket.io`)
- **인증**: `@nestjs/jwt`, `@nestjs/passport`, `passport-jwt`, `bcrypt`
- **DB/ORM**: PostgreSQL 16, Prisma
- **인프라**: Docker, Docker Compose (multi-stage build)

---

## 아키텍처 개요

### 모듈 구조

```
src/
├── main.ts                 # 부트스트랩, 전역 ValidationPipe
├── app.module.ts           # 루트 모듈 (전역 ConfigModule + 각 도메인 모듈)
├── prisma/                 # PrismaService (@Global)
├── users/                  # User 엔티티 CRUD
├── auth/                   # 회원가입/로그인, JWT Access+Refresh, RolesGuard
│   ├── strategies/         # JwtStrategy
│   ├── guards/             # JwtAuthGuard, RolesGuard
│   ├── decorators/         # @Roles()
│   ├── dto/                # Signup / Login / Refresh DTO
│   └── refresh-token.store.ts   # 인메모리 Refresh Token 저장소 (rotation)
├── agents/                 # 상담사 실시간 상태(온라인/배정 수) 인메모리 관리
├── chat/                   # Socket.io Gateway, 배정/메시지/종료, 대기열, 재배정
│   ├── chat.gateway.ts
│   ├── chat.service.ts
│   └── queue.service.ts    # 인메모리 FIFO 대기열
├── admin/                  # 관리자 대시보드 API (ADMIN 전용)
└── common/                 # WsJwtGuard (소켓 JWT 인증)
```

### 주요 흐름 (고객 상담 요청 → 배정 → 채팅 → 종료)

1. **연결/인증** — 클라이언트가 Socket.io로 연결하며 `handshake.auth.token`에 JWT를 담아 보낸다. `WsJwtGuard`가 검증하고 `socket.data.user`에 `{ userId, role }`를 저장한다. 상담사(AGENT)는 연결 시 인메모리 상태가 ONLINE으로 전환된다.
2. **상담 요청** (`request_consultation`) — 고객이 요청하면 `AgentsService.findAvailableAgent()`가 ONLINE 상담사 중 `activeChatCount`가 가장 낮은 사람을 찾아 **즉시 +1 예약**한다. 매칭되면 `ChatRoom`을 `ACTIVE`로 생성하고 고객·상담사를 같은 room(`room:{chatRoomId}`)에 join시킨 뒤 양쪽에 `chat_matched`를 보낸다.
3. **대기열** — 상담 가능한 상담사가 없으면 고객을 인메모리 FIFO 대기열에 넣고 `queued`(순번)를 보낸다. 상담사가 상담을 **종료**하거나 새로 **ONLINE**이 되면 대기열의 맨 앞 고객부터 자동 매칭한다.
4. **채팅** (`send_message`) — 메시지를 `Message` 테이블에 저장하고 같은 room에 `receive_message`로 브로드캐스트한다.
5. **종료** (`end_consultation`) — `ChatRoom`을 `COMPLETED`로 바꾸고 상담사 배정 수를 감소시킨 뒤 `chat_ended`를 보내고 room에서 leave한다.
6. **재배정** — 상담사가 갑자기 끊기면(`handleDisconnect`) 진행 중이던 `ACTIVE` 방들을 `WAITING`으로 되돌리고 고객을 대기열 **맨 앞**에 넣은 뒤 `agent_disconnected`를 보내고 재매칭한다.

---

## 핵심 설계 결정 (Design Decisions)

### 1. 상담사 배정의 동시성 — "동기 블록 예약 패턴"

여러 고객이 거의 동시에 상담을 요청하면, 같은 상담사가 중복 배정되는 경쟁 조건(race condition)이 생길 수 있습니다. 이를 막기 위해 **"가장 여유 있는 상담사 탐색"과 "배정 수 +1"을 하나의 동기 코드 블록(중간에 `await` 없음)에서 함께 처리**합니다.

Node.js는 단일 스레드 이벤트 루프로 동작하므로, `await`가 없는 동기 블록은 중간에 다른 콜백이 끼어들지 못하고 원자적으로 실행됩니다. 따라서 "조회 + 예약"을 붙여두면 별도의 락(lock) 없이도 중복 배정을 방지할 수 있습니다. DB 쓰기(`await`)는 예약이 끝난 뒤에만 수행합니다.

```ts
findAvailableAgent(): string | null {
  let selectedId: string | null = null;
  let minCount = Number.POSITIVE_INFINITY;

  // --- 동기 블록: 여기서는 절대 await 하지 않는다 ---
  for (const [agentId, state] of this.agents.entries()) {
    if (state.status !== 'ONLINE') continue;
    if (state.activeChatCount < minCount) {
      minCount = state.activeChatCount;
      selectedId = agentId;
    }
  }
  if (selectedId !== null) {
    this.agents.get(selectedId)!.activeChatCount += 1; // 찾음과 동시에 즉시 예약
  }
  // --- 동기 블록 끝 ---

  return selectedId;
}
```

대기열 매칭(`tryMatchFromQueue`)도 동일하게 "상담사 예약 + 대기열 dequeue"를 하나의 동기 블록에서 처리합니다.

### 2. Refresh Token Rotation

Access Token 만료를 1일에서 **15분**으로 짧게 줄여 탈취 시 위험 구간을 최소화했습니다. 대신 사용자 경험을 위해 **Refresh Token(7일)**으로 Access Token을 재발급합니다.

Refresh Token은 **Rotation** 방식으로 관리합니다. `POST /api/auth/refresh`가 호출될 때마다 새 Refresh Token을 발급하고, 유저별로 "현재 유효한 최신 토큰"만 인메모리에 저장합니다. 재발급 시 이전 토큰은 덮어써져 즉시 무효화되므로, 탈취된 옛 토큰을 재사용하려는 시도를 차단할 수 있습니다.

- 로그인 시: Access + Refresh 발급, Refresh를 스토어에 저장
- 재발급 시: 전달된 Refresh가 스토어의 최신 값과 일치할 때만 통과 → 새 토큰쌍 발급 후 교체
- 로그아웃 시: 스토어에서 제거

### 3. 왜 지금은 Redis 대신 인메모리인가

현재는 **단일 서버 프로세스**를 전제로, 다음 세 가지 상태를 인메모리로 관리합니다.

| 상태 | 위치 | 자료구조 |
| --- | --- | --- |
| 상담사 온라인/배정 수 | `AgentsService` | `Map<agentId, { status, activeChatCount }>` |
| 대기열 | `QueueService` | 배열(FIFO) |
| Refresh Token | `RefreshTokenStore` | `Map<userId, refreshToken>` |

이 상태들은 "지금 이 순간"의 휘발성 데이터라 DB에 두면 오히려 오버헤드가 크고, 단일 서버에서는 인메모리가 가장 단순하고 빠릅니다. 확장 계획이 없는 현 단계에서 Redis를 도입하면 불필요한 인프라 복잡도만 늘어납니다.

**확장 시 교체 방법**: 서버를 여러 대로 늘리면 프로세스마다 메모리가 분리되어 상태 공유가 깨집니다. 이때는 위 인메모리 저장소들을 **Redis로 교체**합니다.
- 상담사 상태/배정 수 → Redis Hash + 원자적 연산(`HINCRBY`)이나 Lua 스크립트로 "탐색+예약"을 원자화
- 대기열 → Redis List(`LPUSH`/`RPOP`)
- Refresh Token → Redis String(+ TTL)
- 소켓 브로드캐스트 → `socket.io-redis-adapter`로 서버 간 room 이벤트 공유

코드에도 해당 지점마다 `다중 서버 환경에서는 Redis로 교체 필요` 주석을 남겨두었습니다.

### 4. 대기시간 계산(avgWaitTimeSeconds)의 현재 한계

`ChatRoom.matchedAt` 컬럼을 추가하고 `avgWaitTimeSeconds = matchedAt - createdAt`으로 평균 대기시간을 계산합니다. 다만 **현재 구조에서는 이 값이 거의 0에 수렴**합니다. 왜냐하면 `ChatRoom`을 "상담 요청 시점"이 아니라 "매칭이 성사되는 시점"에 생성하므로 `createdAt`과 `matchedAt`이 사실상 같기 때문입니다.

**개선 방향**: 상담 요청 즉시 `ChatRoom`을 `WAITING` 상태로 먼저 생성(`createdAt` = 실제 대기 시작 시각)하고, 매칭이 성사될 때 `ACTIVE`로 전환하며 `matchedAt`을 기록하는 구조로 바꾸면 실제 대기시간이 정확히 측정됩니다. 이 변경은 대기열/재배정 로직에도 영향을 주므로 별도 리팩터링 단계에서 다룰 예정입니다.

---

## API 명세

Base URL: `http://localhost:{PORT}`

| 메서드 | 엔드포인트 | 설명 | 권한 |
| --- | --- | --- | --- |
| POST | `/api/auth/signup` | 회원가입 (email, password, name, role). `role=ADMIN`은 거부 | 공개 |
| POST | `/api/auth/login` | 로그인. `accessToken` + `refreshToken` + `user` 반환 | 공개 |
| POST | `/api/auth/refresh` | `refreshToken`으로 새 토큰쌍 발급 (rotation) | 공개(유효한 refresh 필요) |
| POST | `/api/auth/logout` | 해당 유저의 refresh token 무효화 | 인증(Access Token) |
| GET | `/api/admin/dashboard` | 대기 수 / 온라인 상담사 수 / 진행 중 상담 수 | ADMIN |
| GET | `/api/admin/agents` | 상담사별 상태·배정 수 (인메모리 + User.name 조인) | ADMIN |
| GET | `/api/admin/stats` | 최근 24시간 평균 대기시간/상담시간/총 상담 수 | ADMIN |

> ADMIN 계정은 회원가입으로 만들 수 없으며 시드 스크립트(`prisma/seed.ts`)로 생성합니다. (`admin@test.com` / `admin1234`)
>
> ⚠️ **이 계정은 로컬 개발/테스트 전용입니다.** 실제 배포 환경에서는 시드 실행 후 반드시 비밀번호를 변경하거나, 환경변수(`ADMIN_SEED_EMAIL`, `ADMIN_SEED_PASSWORD`)로 시드 계정 정보를 주입하세요. `prisma/seed.ts`는 이 두 환경변수를 우선 사용하고, 없으면 위 기본값으로 fallback합니다.

---

## Socket.io 이벤트 명세

연결 시 인증: `io(url, { auth: { token: "<accessToken>" } })` (또는 쿼리스트링 `?token=`)

| 이벤트 | 방향 | Payload | 설명 |
| --- | --- | --- | --- |
| `request_consultation` | client → server | `{}` | 고객이 상담 요청 |
| `send_message` | client → server | `{ chatRoomId, content }` | 메시지 전송 |
| `end_consultation` | client → server | `{ chatRoomId }` | 상담사가 상담 종료 |
| `chat_matched` | server → client | `{ chatRoomId, userId, agentId, status, room }` | 매칭 성사 (양쪽에 전달) |
| `queued` | server → client | `{ position, message }` | 대기열 등록 및 순번 안내 |
| `receive_message` | server → client | `{ id, chatRoomId, senderId, content, createdAt }` | 메시지 브로드캐스트 |
| `chat_ended` | server → client | `{ chatRoomId, status, closedAt }` | 상담 종료 알림 |
| `agent_disconnected` | server → client | `{ chatRoomId, message }` | 상담사 끊김 → 재배정 중 안내 |

---

## 실행 방법

### 사전 준비

```bash
cp .env.example .env   # 값 채우기 (JWT_SECRET 등)
```

### A. 로컬 개발 환경 (postgres만 Docker로, 앱은 로컬 실행)

```bash
# 1) Postgres만 컨테이너로 실행
docker-compose up -d postgres

# 2) 의존성 설치 & Prisma Client 생성
npm install
npx prisma generate

# 3) 마이그레이션 적용 & 관리자 시드
npx prisma migrate deploy   # 개발 중 스키마 변경 시에는 npx prisma migrate dev
npx prisma db seed

# 4) 개발 서버 (watch)
npm run start:dev
```

### B. Docker Compose로 전체 스택 한 번에 실행

```bash
docker-compose up --build
```

- `app` 컨테이너는 `postgres`의 healthcheck가 통과한 뒤 시작됩니다.
- 컨테이너 시작 시 `prisma migrate deploy`가 자동 실행된 후 서버가 기동됩니다.
- 앱은 `http://localhost:${PORT}` 에서 접속할 수 있습니다.

---

## 환경 변수 설명

| 변수 | 설명 | 예시 |
| --- | --- | --- |
| `POSTGRES_USER` | Postgres 사용자명 (compose가 사용) | `postgres` |
| `POSTGRES_PASSWORD` | Postgres 비밀번호 | `postgres` |
| `POSTGRES_DB` | Postgres 데이터베이스명 | `chat_service` |
| `DATABASE_URL` | Prisma 접속 URL. 로컬은 `localhost`, docker-compose에서는 `postgres` 서비스명으로 자동 오버라이드 | `postgresql://.../chat_service?schema=public` |
| `JWT_SECRET` | Access Token 서명 secret | `change-me` |
| `JWT_ACCESS_EXPIRES_IN` | Access Token 만료 | `15m` |
| `JWT_REFRESH_SECRET` | Refresh Token 서명 secret (별도 값 권장) | `change-me-refresh` |
| `JWT_REFRESH_EXPIRES_IN` | Refresh Token 만료 | `7d` |
| `PORT` | 앱 리슨 포트 | `3000` |
| `ADMIN_SEED_EMAIL` | (선택) 시드 관리자 이메일. 없으면 `admin@test.com` | `admin@test.com` |
| `ADMIN_SEED_PASSWORD` | (선택) 시드 관리자 비밀번호. 없으면 `admin1234` | `admin1234` |

---

## 향후 개선 계획 (Future Improvements)

- **Redis 도입**: 다중 서버 확장을 위해 상담사 상태/대기열/Refresh Token을 Redis로 이전하고, `socket.io-redis-adapter`로 서버 간 브로드캐스트를 공유.
- **대기시간 계산 개선**: 상담 요청 시 `ChatRoom`을 `WAITING`으로 먼저 생성하도록 구조를 바꿔 실제 대기시간(`avgWaitTimeSeconds`)을 정확히 측정. (현재는 `createdAt ≈ matchedAt`이라 0에 수렴)
- **재배정 방 정합성**: 재배정 시 기존 `WAITING` 방이 그대로 남고 새 방이 생성되는 부분을 정리(기존 방 재사용 또는 정리 로직 추가).
- **프론트엔드 연동**: 고객/상담사/관리자용 웹 클라이언트 추가.
- **테스트 보강**: 단위/통합 테스트(특히 동시성 배정, refresh rotation, 대기열/재배정 시나리오)와 E2E 추가.
- **API 문서화**: Swagger(OpenAPI) 도입.