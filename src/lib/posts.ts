import { sectionById } from "@/config/site";

export type PostFrontmatter = {
  title: string;
  date: string;
  section: string;
  description: string;
  tags?: string[];
  cover?: string;
  draft?: boolean;
};

type MarkdownModule = {
  frontmatter: PostFrontmatter;
  Content: unknown;
};

export type BlogPost = PostFrontmatter & {
  slug: string;
  sectionName: string;
  Content: unknown;
};

const modules = import.meta.glob<MarkdownModule>("../content/posts/*.{md,mdx}", {
  eager: true
});

function slugFromPath(path: string) {
  return path
    .split("/")
    .pop()
    ?.replace(/\.(md|mdx)$/i, "") ?? path;
}

export function getAllPosts() {
  return Object.entries(modules)
    .map(([path, module]) => {
      const section = sectionById(module.frontmatter.section);

      return {
        slug: slugFromPath(path),
        sectionName: section?.name ?? module.frontmatter.section,
        Content: module.Content,
        ...module.frontmatter
      };
    })
    .filter((post) => !post.draft)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

export function getPostsBySection(sectionId: string) {
  return getAllPosts().filter((post) => post.section === sectionId);
}

export function formatDate(date: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric"
  }).format(new Date(date));
}
