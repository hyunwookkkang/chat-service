# syntax=docker/dockerfile:1

# ---- Build stage ----
FROM node:20-slim AS builder
WORKDIR /app

# Prisma 엔진 실행에 필요한 openssl
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# 의존성 설치 (레이어 캐시 최적화를 위해 package 파일 먼저 복사)
COPY package*.json ./
RUN npm ci

# Prisma Client 생성 (schema 필요)
COPY prisma ./prisma
RUN npx prisma generate

# 소스 복사 후 빌드
COPY . .
RUN npm run build

# ---- Production stage ----
FROM node:20-slim AS production
WORKDIR /app

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

# 프로덕션 의존성만 설치
COPY package*.json ./
RUN npm ci --omit=dev

# Prisma schema/migrations 복사 후 Client 생성
COPY prisma ./prisma
RUN npx prisma generate

# 빌드 산출물만 복사
COPY --from=builder /app/dist ./dist

EXPOSE 3000

# 컨테이너 시작 시: 마이그레이션 적용 후 서버 기동
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]