export type Section = {
  id: string;
  name: string;
  description: string;
};

export type LinkItem = {
  title: string;
  href: string;
  description: string;
};

export type FeaturedImage = {
  title: string;
  src: string;
  alt: string;
  section: string;
};

export const site = {
  title: "Gallexy 的个人博客",
  shortTitle: "Gallexy Blog",
  author: "Gallexy Liu",
  description: "记录技术实践、生活观察和项目构想的个人博客。",
  navIntro: "写作、图片、链接和一些正在长大的想法。",
  sections: [
    {
      id: "tech",
      name: "技术",
      description: "开发笔记、工具链、踩坑记录和工程实践。"
    },
    {
      id: "life",
      name: "生活",
      description: "日常观察、阅读摘记、旅行和长期主义。"
    },
    {
      id: "projects",
      name: "项目",
      description: "个人作品、实验原型和阶段性复盘。"
    }
  ] satisfies Section[],
  links: [
    {
      title: "GitHub",
      href: "https://github.com/gallexy-liu",
      description: "代码、实验项目和公开仓库。"
    },
    {
      title: "文章归档",
      href: "/",
      description: "从最近更新开始浏览全部文章。"
    },
    {
      title: "项目页",
      href: "/sections/projects",
      description: "查看正在整理的个人项目。"
    }
  ] satisfies LinkItem[],
  featuredImages: [
    {
      title: "工作台",
      src: "/images/workspace.svg",
      alt: "抽象的写作和编程工作台插画",
      section: "tech"
    },
    {
      title: "城市黄昏",
      src: "/images/city-evening.svg",
      alt: "城市黄昏中的散步路线插画",
      section: "life"
    },
    {
      title: "原型草图",
      src: "/images/prototype.svg",
      alt: "项目原型和路线图插画",
      section: "projects"
    }
  ] satisfies FeaturedImage[]
};

export function sectionById(id: string) {
  return site.sections.find((section) => section.id === id);
}

export function pathWithBase(path: string) {
  const base = import.meta.env.BASE_URL.endsWith("/")
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  const cleanPath = path.replace(/^\/+/, "");
  return `${base}${cleanPath}`;
}
