---
title: "博客开张：从 Markdown 开始"
date: "2026-05-13"
section: "tech"
description: "这个站点用 Astro 构建，文章使用 Markdown 编写，部署到 GitHub Pages。"
tags: ["Astro", "GitHub Pages", "Markdown"]
cover: "/images/workspace.svg"
draft: false
---

这是第一篇示例文章。以后新增文章时，只需要在 `src/content/posts` 目录里放一个新的 Markdown 或 MDX 文件，并补齐开头的 frontmatter。

## 文章字段

每篇文章推荐保留这些字段：

- `title`：文章标题
- `date`：发布日期
- `section`：所属板块，对应 `src/config/site.ts` 里的板块 `id`
- `description`：摘要，会显示在首页和列表页
- `tags`：标签数组
- `cover`：封面图路径
- `draft`：设为 `true` 时不会出现在页面里

## 静态图片

站点级静态图片可以放在 `public/images`。文章里引用时使用 `/images/文件名`，部署到 `/blog` 子路径时，页面模板会负责加上正确的基础路径。
