import React from 'react';

// 화면을 그리다 오류가 나면 하얀 화면 대신 오류 내용을 보여 줌 (원인 파악용 — 화면을 찍어 보내 주시면 바로 찾을 수 있음)
//   onClose: [닫기] (예: 계약서 창 닫기). 없으면 [새로고침]만
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[화면 오류]', error, info?.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="sign-card error-card">
        <p className="text-red bold-text">{this.props.title || '화면을 보여 주는 중 오류가 났습니다.'}</p>
        <p className="sub-text">오류 내용: {String(error?.message || error)}</p>
        <p className="sub-text">이 화면을 찍어서 보내 주시면 원인을 바로 찾을 수 있습니다.</p>
        <div className="inline-fields">
          {this.props.onClose && (
            <button type="button" className="btn-dark-sm" onClick={this.props.onClose}>
              닫기
            </button>
          )}
          <button type="button" className="btn-dark-sm" onClick={() => location.reload()}>
            새로고침
          </button>
        </div>
      </div>
    );
  }
}
