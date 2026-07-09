import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

export default function MarkdownPreview(input: { readonly content: string }) {
  return (
    <ReactMarkdown
      components={{
        a: ({ children, href }) => <a href={href} rel="noreferrer" target="_blank">{children}</a>,
        img: ({ alt, src }) => <a href={src} rel="noreferrer" target="_blank">Image: {alt || src}</a>,
      }}
      remarkPlugins={[remarkGfm]}
    >
      {input.content}
    </ReactMarkdown>
  )
}
