/**
 * 개발 서버 시작 전 PORT(.env 또는 환경변수, 기본 3000)를 점유 중인 프로세스를 종료한다.
 * Windows / macOS / Linux 모두 kill-port 패키지로 처리한다.
 */
const fs = require('fs');
const path = require('path');
const kill = require('kill-port');

function readPortFromEnvFile() {
  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) {
    return undefined;
  }

  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const match = trimmed.match(/^PORT\s*=\s*"?(\d+)"?/);
    if (match) {
      return Number.parseInt(match[1], 10);
    }
  }
  return undefined;
}

function resolvePort() {
  const fromEnvFile = readPortFromEnvFile();
  if (fromEnvFile !== undefined && Number.isFinite(fromEnvFile)) {
    return fromEnvFile;
  }

  const fromProcessEnv = Number.parseInt(process.env.PORT ?? '3000', 10);
  return Number.isFinite(fromProcessEnv) ? fromProcessEnv : 3000;
}

async function main() {
  const port = resolvePort();

  try {
    await kill(port, 'tcp');
    console.log(`[predev] Port ${port} cleared (previous process terminated).`);
  } catch {
    console.log(`[predev] Port ${port} is free (nothing to kill).`);
  }
}

main().catch((error) => {
  console.error('[predev] Failed to clear port:', error);
  process.exit(1);
});
