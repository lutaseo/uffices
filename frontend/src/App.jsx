import React, { useEffect, useState } from 'react';
import { linkProps, match, navigate, useRoute } from './router.js';
import './App.css';

import { useAuth } from './auth/AuthContext.jsx';
import { API_MODE } from './api/index.js';
import { ROLES, ROLE_LABELS } from './auth/permissions.js';
import { formatKoreanDate, today } from './utils/date.js';

import LoginPage from './pages/LoginPage.jsx';
import SignPage from './pages/SignPage.jsx';
import EngineerApp from './pages/EngineerApp.jsx';
import ContractPage from './pages/ContractPage.jsx';
import CustomerManagement from './components/CustomerManagement.jsx';
import ScheduleManagement from './components/ScheduleManagement.jsx';
import ProgressStatus from './components/ProgressStatus.jsx';
import StatsPage from './pages/StatsPage.jsx';
import AccountManagement from './pages/AccountManagement.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import ImportPage from './pages/settings/ImportPage.jsx';
import { EngineerSettings, TeamSettings, ProductSettings, ApartmentSettings, ScheduleSettings } from './pages/settings/MasterSettings.jsx';

// 메뉴 정의. 새 메뉴는 여기에 추가하고 주소(path)와 필요한 권한(perm)만 지정하면 됩니다.
const MENUS = [
  {
    key: 'contract',
    label: '계약관리',
    icon: '📝',
    perm: 'contract.view',
    path: '/contracts',
    subs: [
      { key: 'main', label: '계약관리', path: '/contracts' },
      { key: 'trash', label: '휴지통', path: '/contracts/trash', perm: 'contract.delete' },
    ],
  },
  { key: 'customer', label: '계약자관리', icon: '👤', perm: 'customer.view', path: '/customers' },
  { key: 'schedule', label: '일정관리', icon: '📅', perm: 'schedule.view', path: '/schedule' },
  { key: 'progress', label: '진행상황', icon: '📑', perm: 'stats.view', path: '/progress' },
  { key: 'stats', label: '통계정보', icon: '📊', perm: 'stats.view', path: '/stats' },
  // 운영자 전용 (업체 관리자는 설정 > 사용자관리 에서 실장을 관리)
  { key: 'accounts', label: '업체/계정관리', icon: '🔑', visible: (u) => u.role === ROLES.SUPER, path: '/admin' },
  {
    key: 'setting',
    label: '설정',
    icon: '⚙️',
    always: true,
    subs: [
      { key: 'users', label: '사용자관리', path: '/settings/users', visible: (u) => u.role === ROLES.ADMIN },
      { key: 'engineers', label: '기사관리', path: '/settings/engineers', perm: 'settings.manage' },
      { key: 'teams', label: '팀관리', path: '/settings/teams', perm: 'settings.manage' },
      { key: 'products', label: '상품관리', path: '/settings/products', perm: 'settings.manage' },
      { key: 'apartments', label: '아파트관리', path: '/settings/apartments', perm: 'settings.manage' },
      { key: 'scheduleSetting', label: '일정관리설정', path: '/settings/schedule', perm: 'settings.manage' },
      { key: 'import', label: '데이터 가져오기', path: '/settings/import', visible: (u) => u.role === ROLES.ADMIN },
      { key: 'me', label: '내 정보', path: '/me' },
    ],
  },
];

// 설정 하위 화면
const SETTING_PAGES = {
  users: AccountManagement,
  engineers: EngineerSettings,
  teams: TeamSettings,
  products: ProductSettings,
  apartments: ApartmentSettings,
  scheduleSetting: ScheduleSettings,
  import: ImportPage,
  me: SettingsPage,
};

export default function App() {
  const route = useRoute();
  const { user, loading } = useAuth();

  // 고객 전자서명 페이지는 로그인 없이 접근 (/sign/토큰). 예전 형식(#/sign/토큰) 링크도 지원
  const legacy = window.location.hash.match(/^#\/sign\/([\w-]+)/);
  useEffect(() => {
    if (legacy) navigate(`/sign/${legacy[1]}`, { replace: true });
  }, [legacy?.[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  const sign = match('/sign/:token', route.path);
  if (sign) return <SignPage token={sign.token} />;
  if (legacy) return null;

  if (loading) return <div className="page-loading">불러오는 중...</div>;
  if (!user) return <LoginPage companyCode={route.base} />;
  return <CompanyGate route={route} />;
}

// 로그인한 계정의 업체 주소(/thegood/...)로 맞춰서 보여줌. 운영자는 업체 코드 없는 주소(/admin)
function CompanyGate({ route }) {
  const { user, company } = useAuth();
  const code = user.role === ROLES.SUPER ? '' : company?.code || '';
  const wrongBase = route.base !== code;
  useEffect(() => {
    if (wrongBase) navigate(`${route.path}${window.location.search}`, { replace: true, base: code });
  }, [wrongBase, code, route.path]);
  if (wrongBase) return null;
  if (user.role === ROLES.ENGINEER) return <EngineerApp route={route} />;
  return <MainLayout route={route} />;
}

// 주소가 어느 메뉴에 속하는지
const belongsTo = (m, path) =>
  m.key === 'setting'
    ? path.startsWith('/settings') || path === '/me'
    : path === m.path || path.startsWith(`${m.path}/`);

function MainLayout({ route }) {
  const { user, company, logout, can } = useAuth();
  const { path } = route;

  const allowed = (item) => {
    if (item.visible) return item.visible(user);
    return !item.perm || can(item.perm);
  };
  const menus = MENUS.filter((m) => {
    if (user.role === ROLES.SUPER) return m.key === 'accounts' || m.key === 'setting';
    return m.always || allowed(m);
  })
    .map((m) => ({ ...m, subs: (m.subs || []).filter(allowed) }))
    .map((m) => ({ ...m, path: m.path || m.subs[0]?.path }));

  const [openDropdown, setOpenDropdown] = useState(null);
  const current = menus.find((m) => belongsTo(m, path));
  const home = menus[0]?.path || '/me';

  // 첫 화면(/) 또는 권한 없는 주소 → 기본 화면으로
  useEffect(() => {
    if (!current) navigate(home, { replace: true });
  }, [path, current?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (to) => {
    setOpenDropdown(null);
    navigate(to);
  };

  const handleLogout = async () => {
    await logout();
    navigate('/', { replace: true });
  };

  const periodEnd = company?.periodEnd;
  const daysLeft = periodEnd
    ? Math.ceil((new Date(`${periodEnd}T00:00:00`) - new Date(`${today()}T00:00:00`)) / 86400000)
    : null;

  const subActive = (s) => (s.key === 'main' ? path === s.path || /^\/contracts\/(\d+|new)/.test(path) : path.startsWith(s.path));

  return (
    <div className="app-container">
      <header className="app-header">
        <a className="brand-logo" {...linkProps(home, go)}>
          <span className="logo-box">U</span>
          <span className="logo-text">{company ? `${company.name} UFFICE` : 'UFFICE 운영자'}</span>
        </a>
        <nav className="main-nav-bar">
          {menus.map((m) => (
            <div
              key={m.key}
              className={`nav-item ${current?.key === m.key ? 'active' : ''}`}
              onMouseEnter={() => m.subs.length > 1 && setOpenDropdown(m.key)}
              onMouseLeave={() => setOpenDropdown(null)}
            >
              <a className="nav-link" {...linkProps(m.path, go)}>
                <div className="nav-icon">{m.icon}</div>
                <span className="nav-label">{m.label}</span>
              </a>
              {openDropdown === m.key && (
                <div className="dropdown-menu">
                  {m.subs.map((s) => (
                    <a key={s.key} className={`dropdown-item ${subActive(s) ? 'active-sub' : ''}`} {...linkProps(s.path, go)}>
                      {s.label}
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>
      </header>

      <div className="sub-header">
        <div className="quick-btn-group">
          {can('customer.edit') && (
            <a className="btn-quick blue" {...linkProps('/customers?new=1', go)}>
              👤 계약자 등록
            </a>
          )}
          {can('contract.create') && (
            <a className="btn-quick primary" {...linkProps('/contracts/new', go)}>
              ✏️ 빠른계약등록
            </a>
          )}
        </div>
        <div className="welcome">
          {API_MODE === 'demo' && (
            <span className="demo-badge" title="서버 연결 전: 입력한 데이터는 이 브라우저에만 저장됩니다">
              데모 모드 · 브라우저 저장
            </span>
          )}
          <span className="welcome-date">{formatKoreanDate(today())}</span>
          <span>
            {user.name}({ROLE_LABELS[user.role]})님 환영합니다.
          </span>
          {daysLeft !== null && daysLeft <= 14 && (
            <span className="period-warning">이용기간 만료 {daysLeft}일 전 ({periodEnd})</span>
          )}
          <button type="button" className="btn-logout" onClick={handleLogout}>
            로그아웃
          </button>
        </div>
      </div>

      {/* 하위 메뉴 탭 (휴대폰에서도 이동할 수 있도록 화면에 표시) */}
      {current && current.subs.length > 1 && (
        <div className="sub-nav">
          {current.subs.map((s) => (
            <a key={s.key} className={subActive(s) ? 'active' : ''} {...linkProps(s.path, go)}>
              {s.label}
            </a>
          ))}
        </div>
      )}

      <main className="content">
        {current?.key === 'contract' && <ContractPage route={route} />}
        {current?.key === 'customer' && <CustomerManagement route={route} />}
        {current?.key === 'schedule' && <ScheduleManagement />}
        {current?.key === 'progress' && <ProgressStatus />}
        {current?.key === 'stats' && <StatsPage />}
        {current?.key === 'accounts' && <AccountManagement />}
        {current?.key === 'setting' && <SettingPage path={path} subs={current.subs} />}
      </main>
    </div>
  );
}

function SettingPage({ path, subs }) {
  const sub = subs.find((s) => path === s.path || path.startsWith(`${s.path}/`));
  useEffect(() => {
    if (!sub && subs[0]) navigate(subs[0].path, { replace: true });
  }, [path]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!sub) return null;
  const Page = SETTING_PAGES[sub.key];
  return <Page path={path} />;
}
