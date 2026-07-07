# syntax=docker/dockerfile:1


# ==========================================
# [로컬 백업용] 기존 Dockerfile (필요할 때 주석 해제)
# ==========================================
# # syntax=docker/dockerfile:1
# FROM node:20-slim AS builder
# WORKDIR /app
# ...
# # ---- Build stage ----
# FROM node:20-slim AS builder
# WORKDIR /app

# # Prisma 엔진 실행에 필요한 openssl
# RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# # 의존성 설치 (레이어 캐시 최적화를 위해 package 파일 먼저 복사)
# COPY package*.json ./
# RUN npm ci

# # Prisma Client 생성 (schema 필요)
# COPY prisma ./prisma
# RUN npx prisma generate

# # 소스 복사 후 빌드
# COPY . .
# RUN npm run build

# # ---- Production stage ----
# FROM node:20-slim AS production
# WORKDIR /app

# RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# ENV NODE_ENV=production

# # 프로덕션 의존성만 설치 (prisma CLI는 dependencies로 이동되어 migrate deploy 가능)
# COPY package*.json ./
# RUN npm ci --omit=dev

# # Prisma schema/migrations 복사 후 Client 생성
# COPY prisma ./prisma
# RUN npx prisma generate

# # 빌드 산출물만 복사
# COPY --from=builder /app/dist ./dist

# # 컨테이너 시작 시: 마이그레이션 적용 후 서버 기동
# CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"] 
#...
# CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]


# ==========================================
# [AWS 배포용] t3.nano 초경량 최적화 Dockerfile
# ==========================================
# syntax=docker/dockerfile:1

# ---- Build stage ----
    FROM node:20-alpine AS builder
    WORKDIR /app
    
    RUN apk add --no-cache openssl libc6-compat
    
    COPY package*.json ./
    RUN npm ci
    
    COPY prisma ./prisma
    RUN npx prisma generate
    
    COPY . .
    RUN npm run build
    
    # ---- Production stage ----
    FROM node:20-alpine AS production
    WORKDIR /app
    
    RUN apk add --no-cache openssl libc6-compat
    ENV NODE_ENV=production
    
    COPY package*.json ./
    RUN npm ci --omit=dev
    
    COPY prisma ./prisma
    RUN npx prisma generate
    
    COPY --from=builder /app/dist ./dist
    
    EXPOSE 3000
    CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]