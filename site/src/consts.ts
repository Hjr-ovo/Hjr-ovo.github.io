// 站点级固定值。改这里，全站生效。
// 集中放一处，避免同一个站点名散落在十几个文件里。

export const SITE = {
  title: 'Hjr-ovo的博客',
  description: '计算机学习、开发工具踩坑、项目实践 —— 都是自己真踩过的。',
  author: 'Hjr-ovo',
  lang: 'zh-CN',
  avatar: '/avatar.png',
  // 公开联系邮箱。刻意选不含姓名拼音的那个地址
  email: 'hjr.ovo@gmail.com',
} as const;
