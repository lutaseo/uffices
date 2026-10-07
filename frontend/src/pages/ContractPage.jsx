import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { contracts as contractApi, engineers as engineerApi, users as userApi } from '../api/index.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { ROLES, isOwnScopeOnly } from '../auth/permissions.js';
import SearchFilter, { EMPTY_FILTER } from '../components/SearchFilter.jsx';
import ContractTable from '../components/ContractTable.jsx';
import ContractEditor from './ContractEditor.jsx';
import ContractDetail from './ContractDetail.jsx';
import ContractViewModal from '../components/ContractViewModal.jsx';
import KakaoModal from '../components/KakaoModal.jsx';
import Pagination from '../components/Pagination.jsx';
import { calcAmounts, itemsSummary, summarize, timeLabel } from '../utils/contract.js';
import { formatAddress, won } from '../utils/format.js';
import { downloadExcel } from '../utils/excel.js';
import { goBack, match, navigate, navigateForward } from '../router.js';

const PAGE_SIZE = 20;
const FILTER_KEY = 'uffice.contractFilter';
const PAGE_KEY = 'uffice.contractPage';

function loadSavedFilter() {
  try {
    return { ...EMPTY_FILTER, ...JSON.parse(sessionStorage.getItem(FILTER_KEY) || '{}') };
  } catch {
    return EMPTY_FILTER;
  }
}

// 주소에 따라 목록 / 상세 / 작성 화면을 보여줌 (브라우저 뒤로가기로 이전 화면 이동)
export default function ContractPage({ route }) {
  const { can } = useAuth();
  const [engineers, setEngineers] = useState([]);
  useEffect(() => {
    engineerApi.list().then(setEngineers).catch(() => {});
  }, []);
  const { path, query } = route;

  // 저장: 이전 화면이 상세면 뒤로, 아니면 새 계약 상세로 / 취소: 이전 화면으로
  const closeEditor = (saved) => {
    if (saved && !window.history.state?.canGoBack) navigate(`/contracts/${saved.id}`, { replace: true });
    else goBack('/contracts');
  };

  if (path === '/contracts/new') {
    if (!can('contract.create')) return <NoPermission />;
    const from = query.get('from');
    const category = query.get('category') || '';
    return <ContractEditor key={`new-${from || ''}-${category}`} contractId={null} prefillFrom={from} prefillCategory={category} engineers={engineers} onClose={closeEditor} />;
  }
  const edit = match('/contracts/:id/edit', path);
  if (edit) {
    if (!can('contract.edit')) return <NoPermission />;
    return <ContractEditor key={`edit-${edit.id}`} contractId={Number(edit.id)} engineers={engineers} onClose={closeEditor} />;
  }
  const detail = match('/contracts/:id', path);
  if (detail && /^\d+$/.test(detail.id)) {
    return (
      <ContractDetail
        key={detail.id}
        contractId={Number(detail.id)}
        onBack={() => goBack('/contracts')}
        onEdit={(c) => navigateForward(`/contracts/${c.id}/edit`)}
        onNewWork={(c, category) => navigateForward(`/contracts/new?from=${c.id}${category ? `&category=${encodeURIComponent(category)}` : ''}`)}
        onOpenGroup={(id) => navigateForward(`/contracts/${id}`)}
      />
    );
  }
  const trash = path === '/contracts/trash';
  if (trash && !can('contract.delete')) return <NoPermission />;
  return <ContractList key={trash ? 'trash' : 'main'} trash={trash} engineers={engineers} />;
}

function NoPermission() {
  return (
    <div className="page-card">
      <p className="no-data">이 화면을 볼 권한이 없습니다.</p>
    </div>
  );
}

// 최근에 받은 계약 목록 (화면을 옮겼다 돌아와도 바로 보여주고, 서버에는 '바뀐 게 있는지'만 물어봄)
//   계정·휴지통·검색조건별로 따로 기억. 새로고침하면 비워짐
const listCache = new Map();

function ContractList({ trash, engineers }) {
  const { user, can, handleError } = useAuth();
  const showAmount = can('contract.amount');
  const showTotals = showAmount && can('sales.total'); // 회사 전체 매출 합계는 관리자가 허락한 계정만

  const [filter, setFilter] = useState(loadSavedFilter);
  const cacheKey = `${user.id}|${trash ? 1 : 0}|${JSON.stringify(filter)}`;
  const [rows, setRows] = useState(() => listCache.get(cacheKey)?.rows || []);
  const [loading, setLoading] = useState(() => !listCache.has(cacheKey));
  // 쪽 번호는 기억해 두어, 상세에서 뒤로 왔을 때 같은 쪽을 보여줌
  const [page, setPageState] = useState(() => Number(sessionStorage.getItem(`${PAGE_KEY}.${trash}`)) || 1);
  const setPage = (n) => {
    setPageState(n);
    sessionStorage.setItem(`${PAGE_KEY}.${trash}`, String(n));
  };
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [staff, setStaff] = useState([]);
  const [viewId, setViewId] = useState(null);
  const [kakaoTarget, setKakaoTarget] = useState(null);

  const load = useCallback(async () => {
    const cached = listCache.get(cacheKey);
    if (cached) setRows(cached.rows); // 기억해 둔 목록을 먼저 보여주고
    else setLoading(true);
    try {
      const r = await contractApi.listCached({ ...filter, trash }, cached?.version || '');
      if (r.unchanged && cached) return; // 바뀐 게 없으면 그대로 (받는 데이터 거의 없음)
      listCache.set(cacheKey, { version: r.version, rows: r.rows });
      if (listCache.size > 20) listCache.delete(listCache.keys().next().value); // 오래된 검색조건부터 비움
      setRows(r.rows);
    } catch (e) {
      handleError(e);
    } finally {
      setLoading(false);
    }
  }, [filter, trash, handleError, cacheKey]);

  useEffect(() => {
    load();
  }, [load]);

  // 검색 조건이 바뀌면 첫 쪽으로 (처음 열릴 때는 기억한 쪽 유지)
  const firstFilter = useRef(true);
  useEffect(() => {
    setSelectedIds(new Set());
    if (firstFilter.current) {
      firstFilter.current = false;
      return;
    }
    setPage(1);
  }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // 본인 건만 보는 실장에게는 작성자 필터가 의미 없으므로 숨김
    if (!isOwnScopeOnly(user)) userApi.staffOptions().then(setStaff).catch(() => {});
  }, [user]);

  const handleSearch = (next) => {
    setFilter(next);
    sessionStorage.setItem(FILTER_KEY, JSON.stringify(next));
  };

  const summary = useMemo(() => summarize(rows), [rows]);
  const maxPage = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, maxPage); // 기억한 쪽이 범위를 넘으면 마지막 쪽
  const pageRows = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const toggle = (id) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = (checked) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      pageRows.forEach((r) => (checked ? next.add(r.id) : next.delete(r.id)));
      return next;
    });

  const bulk = async (action, confirmMsg, ...args) => {
    if (!selectedIds.size) {
      alert('선택된 계약이 없습니다.');
      return;
    }
    if (!window.confirm(`${selectedIds.size}건을 ${confirmMsg}`)) return;
    try {
      await contractApi[action]([...selectedIds], ...args);
      await load();
    } catch (e) {
      handleError(e);
    }
  };

  const handleExport = () => {
    downloadExcel(
      rows.map((c) => {
        const a = calcAmounts(c);
        const row = {
          번호: c.no,
          브랜드: c.brand,
          구분: c.category,
          접수형태: c.receptionType,
          시공상태: c.status,
          전자계약: c.esign?.status,
          계약일: c.contractDate,
          시공종류: c.workType,
          계약승인: c.approval,
          '시공 등록': c.schedules.map((s) => s.date && `${s.date} ${timeLabel(s)}`.trim()).filter(Boolean).join(', ') || '미정',
          시공담당: c.schedules.map((s) => s.assigneeName).filter(Boolean).join(', ') || '미배정',
          모바일웹: c.schedules.map((s) => s.mobileStatus || '입력 전').join(', '),
          입주예정일: c.moveInDate,
          시공완료일: c.completedDate,
          취소일: c.canceledDate,
          계약자: c.customerName,
          연락처: c.customerPhone,
          연락처2: c.customerPhone2,
          '아파트명/현장': formatAddress(c),
          평수: c.area,
          시공내용: itemsSummary(c),
          취소사유: c.cancelReason,
          작성자: c.ownerName,
        };
        if (showTotals) {
          Object.assign(row, {
            시공총액: a.total,
            할인: a.discount,
            상품권: a.voucher,
            실계약금: a.actual,
            매출취소: a.canceled,
            입금: a.paid,
            환불: a.refund,
            잔액: a.balance,
          });
        }
        return row;
      }),
      '계약목록',
      trash ? '계약관리_휴지통' : '계약관리_목록',
    );
  };

  const renderActions = (item) =>
    trash ? (
      <span className="sub-text">삭제 {item.deletedAt?.slice(0, 10)}</span>
    ) : (
      <div className="row-actions">
        <button type="button" className="btn-dark-action" onClick={() => setViewId(item.id)}>
          계약서
        </button>
        {can('contract.edit') && (
          <button type="button" className="btn-outline-action" onClick={() => navigateForward(`/contracts/${item.id}/edit`)}>
            수정
          </button>
        )}
        {can('notify.send') && (
          <button type="button" className="btn-kakao-talk sm" onClick={() => setKakaoTarget(item)}>
            알림톡
          </button>
        )}
      </div>
    );

  return (
    <div className="page-card">
      <div className="page-title-row">
        <h2>{trash ? '🗑️ 휴지통' : '계약관리'}</h2>
        {user.role === ROLES.MANAGER && isOwnScopeOnly(user) && <span className="scope-badge">본인 작성 계약만 표시</span>}
      </div>

      <SearchFilter
        filter={filter}
        onSearch={handleSearch}
        staff={staff}
        engineers={engineers}
        actions={
          <>
            {!trash && can('contract.create') && (
              <button type="button" className="btn-dark-lg sm" onClick={() => navigateForward('/contracts/new')}>
                + 계약등록
              </button>
            )}
            {can('excel.export') && (
              <button type="button" className="btn-dark-lg sm" onClick={handleExport}>
                📄 엑셀다운로드
              </button>
            )}
          </>
        }
      />

      <div className="summary-box">
        <div>
          <span className="summary-label">총 {summary.count}건</span>
          <span className="sub-text">(시공완료 {summary.completed}건 · 취소 {summary.canceled}건)</span>
        </div>
        {showTotals && (
          <>
            <div>
              <span className="summary-label">실계약금액</span>
              {won(summary.actual)}원 <span className="sub-text">(할인 {won(summary.discount)} · 상품권 {won(summary.voucher)})</span>
            </div>
            <div>
              <span className="summary-label">입금액</span>
              {won(summary.paid)}원{' '}
              <span className="sub-text">
                ({Object.entries(summary.paidBy).map(([k, v]) => `${k} ${won(v)}`).join(' · ') || '-'})
              </span>
            </div>
            <div>
              <span className="summary-label">매출취소총액</span>
              {won(summary.canceledAmount)}원 <span className="sub-text">(취소 건은 합계에서 제외)</span>
            </div>
            <div>
              <span className="summary-label">환불금액</span>
              {won(summary.refund)}원
            </div>
            <div>
              <span className="summary-label">남은금액</span>
              <strong>{won(summary.balance)}원</strong>
            </div>
          </>
        )}
      </div>

      {(can('contract.delete') || can('contract.approve')) && (
        <div className="bulk-bar">
          <span className="sub-text">선택 {selectedIds.size}건</span>
          {!trash && can('contract.approve') && (
            <>
              <button type="button" className="btn-outline-action" onClick={() => bulk('setApproval', '승인 처리하시겠습니까?', '승인')}>
                선택 승인
              </button>
              <button type="button" className="btn-outline-action" onClick={() => bulk('setApproval', '미승인 처리하시겠습니까?', '미승인')}>
                선택 미승인
              </button>
            </>
          )}
          {!can('contract.delete') ? null : trash ? (
            <>
              <button type="button" className="btn-outline-action" onClick={() => bulk('restore', '복구하시겠습니까?')}>
                복구
              </button>
              <button type="button" className="btn-text-danger" onClick={() => bulk('purge', '영구삭제하시겠습니까? 되돌릴 수 없습니다.')}>
                영구삭제
              </button>
            </>
          ) : (
            <button type="button" className="btn-text-danger" onClick={() => bulk('moveToTrash', '휴지통으로 이동하시겠습니까?')}>
              선택 삭제(휴지통)
            </button>
          )}
        </div>
      )}

      {loading ? (
        <div className="page-loading">불러오는 중...</div>
      ) : (
        <>
          <ContractTable
            contracts={pageRows}
            selectedIds={selectedIds}
            onToggle={toggle}
            onToggleAll={toggleAll}
            showAmount={showAmount}
            renderActions={renderActions}
            onOpen={trash ? undefined : (c) => navigateForward(`/contracts/${c.id}`)}
          />
          <Pagination page={currentPage} total={rows.length} pageSize={PAGE_SIZE} onChange={setPage} />
        </>
      )}

      {viewId && <ContractViewModal contractId={viewId} onClose={() => setViewId(null)} onChanged={load} />}
      {kakaoTarget && <KakaoModal contract={kakaoTarget} onClose={() => setKakaoTarget(null)} />}
    </div>
  );
}
