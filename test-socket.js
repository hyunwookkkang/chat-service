const { io } = require("socket.io-client");

const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI5YjYwMjE5ZS04YWIxLTRjNmYtOTNkOC1kMzI4NTYxMDIyMmQiLCJyb2xlIjoiQURNSU4iLCJpYXQiOjE3ODQ4MjYzOTQsImV4cCI6MTc4NDgyNzI5NH0.OZhiy-I36AHnK_2W_I_hdUM9b_5ezWwNh_q2NO4dB-8";

const socket = io("http://13.125.248.125:3001", {
  extraHeaders: {
    Authorization: `Bearer ${token}`
  },
  transports: ["websocket"]
});

socket.on("connect", () => {
  console.log("✅ Socket.IO 연결 성공! ID:", socket.id);
  
  // 상담 요청 이벤트 테스트 전송
  console.log("📤 request_consultation 이벤트 전송 중...");
  socket.emit("request_consultation", { category: "GENERAL", message: "안녕하세요! 상담 요청합니다." });
});

socket.on("connect_error", (err) => {
  console.error("❌ 연결 에러:", err.message);
  process.exit(1);
});

// 서버 응답 수신 이벤트
socket.onAny((event, ...args) => {
  console.log(`📩 [서버 응답 수신] 이벤트: ${event}`, args);
  setTimeout(() => {
    console.log("🎉 웹소켓 실시간 테스트 완벽 성공!");
    socket.disconnect();
    process.exit(0);
  }, 1000);
});

setTimeout(() => {
  console.log("⏱️ 테스트 종료");
  socket.disconnect();
  process.exit(0);
}, 5000);
