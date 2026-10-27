// 저장한 화면 테마를 첫 화면을 그리기 전에 적용합니다. 저장값이 없으면 운영체제 설정을 따릅니다.
try {
  const theme = localStorage.getItem('asset-kit:theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
} catch { /* 저장소를 쓸 수 없으면 운영체제 설정을 따릅니다. */ }
