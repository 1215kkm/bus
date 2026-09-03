/*
 * 도시 목록과 노선 종류 정의
 * ------------------------------------------------------------
 * 새 도시 추가: 아래 SB_CITIES 에 항목을 넣고 js/data/routes.<id>.js 에 노선을 작성한 뒤
 * index.html 에 스크립트를 추가하면 도시 선택 메뉴에 나타납니다.
 *
 * live : 실시간 어댑터 (server.js)
 *   seoul → 서울시 TOPIS (ws.bus.go.kr)
 *   gbis  → 경기버스정보 (data.go.kr 6410000), region 으로 노선 검색 결과를 걸러냄
 *   tago  → 국토교통부 전국 버스정보 (data.go.kr 1613000), cityCode 필요
 */
window.SB_ROUTE_TYPES = {
  trunk:    { label: '간선',     color: '#4f7de8', order: 1 },
  branch:   { label: '지선',     color: '#5fc244', order: 2 },
  wide:     { label: '광역',     color: '#f0453c', order: 3 },
  express:  { label: '직행좌석', color: '#f0453c', order: 3 },
  mbus:     { label: '광역급행', color: '#ff7a45', order: 4 },
  local:    { label: '일반시내', color: '#4cc38a', order: 5 },
  circular: { label: '순환',     color: '#f5c22b', order: 6 },
  village:  { label: '마을',     color: '#a3d63c', order: 7 },
  night:    { label: '심야',     color: '#9b7bff', order: 8 },
};

window.SB_CITIES = {
  seoul: {
    name: '서울', sub: '서울 시내버스',
    camera: { center: [126.99, 37.548], zoom: 11.7, pitch: 58, bearing: -14 },
    live: { adapter: 'seoul' },
  },
  yongin: {
    name: '용인', sub: '용인시 · 경기도 버스',
    camera: { center: [127.135, 37.29], zoom: 11.9, pitch: 58, bearing: -20 },
    live: { adapter: 'gbis', region: '용인', tagoCityCode: 31190 },
  },
};
