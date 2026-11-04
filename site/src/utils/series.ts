// 系列内排序
//
// 背景：一篇文章常常是某个序列里的一章（软件工程笔记的第 1 章、2-1 章、2-2 章……），
// 这些章的发布日期往往只差一两天、甚至同一天。只按日期排的话：
//   1. 同一天的多篇谁前谁后取决于文件加载顺序，**每次构建都可能是另一个顺序**；
//   2. 章节顺序和写作日期本来就不是一回事（先补第 1 章、后写第 2 章很常见）。
//
// 所以引入「系列」这层组织。三条规则：
//   1. 同一个系列的文章**聚成一组**，不许被别组的文章插在中间；
//   2. 整组的位置由组内**最新一篇**的日期决定 —— 新系列整体上浮，老系列自然沉下去；
//   3. 组内按 seriesOrder 升序（第 1 章永远在第 2 章前面）。
//
// 为什么不做成「独立系列页」：系列就是分类下面的一段有序序列，分类页已经承担了
// 这个职能，再开一个 /series/xxx 只是把同一批文章换个入口，2026-11-04 讨论时否掉了。
//
// 哪些页面用它、哪些不用（不是遗漏，是有意为之）：
//   ✅ 首页、分类页、标签页 —— 读者在这里找的是「有哪些文章可读」，成组更好扫；
//   ❌ 归档页 /posts/ —— 那里是时间轴，按月分组，塞系列排序会和「时间」自相矛盾；
//   ❌ RSS —— 订阅者要的是时间线，不是章节表。

type Sortable = {
  id: string;
  data: {
    pubDate: Date;
    title: string;
    series?: string;
    seriesOrder?: number;
  };
};

/**
 * 组内次序键。没填 seriesOrder 的排到组末尾（MAX_SAFE_INTEGER），
 * 而不是当成 0 —— 当成 0 会让「还没编号的那篇」莫名其妙顶到组首。
 */
const orderKey = (post: Sortable): number =>
  post.data.seriesOrder ?? Number.MAX_SAFE_INTEGER;

/** 组内比较：先按序号，序号相同（或都没填）再按日期升序，最后按标题兜底 */
function compareInSeries(a: Sortable, b: Sortable): number {
  const byOrder = orderKey(a) - orderKey(b);
  if (byOrder !== 0) return byOrder;
  const byDate = a.data.pubDate.valueOf() - b.data.pubDate.valueOf();
  if (byDate !== 0) return byDate;
  return a.data.title.localeCompare(b.data.title, 'zh-CN');
}

/**
 * 系列感知排序：同系列聚拢，整组按组内最新日期定位，组内按序号升序。
 *
 * 不带 series 的文章按日期倒序，和以前的规则完全一样 ——
 * 也就是说「不用系列」这件事本身没有任何额外代价。
 */
export function sortBySeries<T extends Sortable>(posts: T[]): T[] {
  // 每个系列的「代表日期」= 组内最新一篇的发布日期
  const latestOf = new Map<string, number>();
  for (const post of posts) {
    const name = post.data.series;
    if (!name) continue;
    const stamp = post.data.pubDate.valueOf();
    const current = latestOf.get(name);
    if (current === undefined || stamp > current) latestOf.set(name, stamp);
  }

  // 组的位置看代表日期，单篇看自己的日期
  const positionOf = (post: Sortable): number =>
    post.data.series
      ? latestOf.get(post.data.series)!
      : post.data.pubDate.valueOf();

  return [...posts].sort((a, b) => {
    const pa = positionOf(a);
    const pb = positionOf(b);
    if (pa !== pb) return pb - pa;

    // 代表日期相同：同组按序号排；不同组按自己的日期，再按标题，
    // 保证结果是确定的（同一天的两个系列不会随机换位置）
    if (a.data.series && a.data.series === b.data.series) {
      return compareInSeries(a, b);
    }

    const byDate = b.data.pubDate.valueOf() - a.data.pubDate.valueOf();
    if (byDate !== 0) return byDate;
    return a.data.title.localeCompare(b.data.title, 'zh-CN');
  });
}

/**
 * 取前 limit 篇，但**不把系列切开**。
 *
 * 首页只放 10 篇，如果第 10 篇正好是个系列的第 2 章，读者会看到「2/4」却找不到
 * 1、3、4 —— 那比少显示几篇更让人困惑。所以按「组」为单位累加，
 * 组内一旦开始就加到组结束。代价是首页偶尔会超过 10 篇。
 */
export function takeWholeSeries<T extends Sortable>(posts: T[], limit: number): T[] {
  const taken: T[] = [];
  let index = 0;

  while (index < posts.length && taken.length < limit) {
    const series = posts[index].data.series;

    if (!series) {
      taken.push(posts[index]);
      index += 1;
      continue;
    }

    // 已排好序的数组里，同系列一定是连续的一段
    while (index < posts.length && posts[index].data.series === series) {
      taken.push(posts[index]);
      index += 1;
    }
  }

  return taken;
}

/** 一篇系列文章在组内的位置信息 */
export type SeriesPosition = {
  name: string;
  /** 组内第几篇，从 1 开始 */
  index: number;
  total: number;
};

/**
 * 算出「每篇文章在各自系列里的位置」。
 *
 * 列表卡片上要显示「软件工程 · 2/4」，而这里的 2/4 必须和文章页里的
 * 上一篇/下一篇完全一致 —— 所以位置只在这里算一次，两处共用，
 * 免得一边按序号算、一边按数组下标算，对不上。
 */
export function buildSeriesPositions(posts: Sortable[]): Map<string, SeriesPosition> {
  const groups = new Map<string, Sortable[]>();
  for (const post of posts) {
    const name = post.data.series;
    if (!name) continue;
    const list = groups.get(name);
    if (list) list.push(post);
    else groups.set(name, [post]);
  }

  const positions = new Map<string, SeriesPosition>();
  for (const [name, members] of groups) {
    const ordered = [...members].sort(compareInSeries);
    ordered.forEach((post, i) => {
      positions.set(post.id, { name, index: i + 1, total: ordered.length });
    });
  }

  return positions;
}

/** 系列导航：文章页底部要的全部信息 */
export type SeriesNav<T> = {
  name: string;
  index: number;
  total: number;
  /** 第一篇没有上一篇，为 null */
  prev: T | null;
  /** 最后一篇没有下一篇，为 null */
  next: T | null;
  /** 整个系列的成员，按序号排好，供折叠目录用 */
  members: T[];
};

/**
 * 取某篇文章的系列导航；不属于任何系列（或者系列里只有它自己）时返回 null。
 *
 * 只有一篇的「系列」不出导航：显示「本篇 1/1」外加一个无法点击的上一篇，
 * 纯属噪音。
 */
export function getSeriesNav<T extends Sortable>(post: T, all: T[]): SeriesNav<T> | null {
  const name = post.data.series;
  if (!name) return null;

  const members = all
    .filter((item) => item.data.series === name)
    .sort(compareInSeries);

  if (members.length < 2) return null;

  const at = members.findIndex((item) => item.id === post.id);
  if (at < 0) return null;

  return {
    name,
    index: at + 1,
    total: members.length,
    prev: members[at - 1] ?? null,
    next: members[at + 1] ?? null,
    members,
  };
}
