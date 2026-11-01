// 站点级固定值。改这里，全站生效。
// 集中放一处，避免同一个站点名散落在十几个文件里。

export const SITE = {
  title: 'Hjr-ovo的博客',
  // 首页标题下面那句slogan（2026-11-01 换过）
  tagline: '空谈无益，放码过来。',
  // 给搜索引擎看的站点描述。和 tagline 分开是有意的：
  // 口号当 meta description 没信息量，陌生人搜「哈希表」时帮不上忙
  description: '计算机学习、开发工具踩坑、项目实践 —— 都是自己真踩过的。',
  author: 'Hjr-ovo',
  lang: 'zh-CN',
  avatar: '/avatar.png',
  // 公开联系邮箱。刻意选不含姓名拼音的那个地址
  email: 'hjr.ovo@gmail.com',
} as const;
