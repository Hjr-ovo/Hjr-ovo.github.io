// 日期格式化：把 Date 对象变成中文习惯的写法
//
// 集中放一处的原因：首页、文章页、将来的分类页都要显示日期，
// 各写一份迟早会不一致（有的显示 2026-09-20，有的显示 2026年9月20日）。

/** 格式化成 `2026 年 9 月 20 日` */
export function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  return `${y} 年 ${m} 月 ${d} 日`;
}

/** 格式化成 `2026-09-20`，给 <time datetime=""> 用（机器读的格式） */
export function isoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
