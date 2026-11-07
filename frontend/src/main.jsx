import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { AuthProvider } from './auth/AuthContext.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { startUpdateCheck } from './utils/updateCheck.js';
import './App.css';

// 날짜 칸: 달력 아이콘을 누르지 않아도 칸 아무 곳이나 누르면 달력이 열림 (키보드 입력도 그대로 가능)
const PICKER_TYPES = ['date', 'month', 'datetime-local'];
document.addEventListener('click', (e) => {
  const el = e.target;
  if (!(el instanceof HTMLInputElement) || !PICKER_TYPES.includes(el.type) || el.readOnly || el.disabled) return;
  try {
    el.showPicker?.();
  } catch {
    // 지원하지 않는 브라우저는 기본 동작 (달력 아이콘)
  }
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);

// 새로 배포되면 휴대폰·태블릿에서 열어 둔 예전 화면도 새 버전으로 (utils/updateCheck.js)
startUpdateCheck();
