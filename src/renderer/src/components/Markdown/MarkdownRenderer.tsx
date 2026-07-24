import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import 'katex/dist/katex.min.css'
import 'highlight.js/styles/github-dark.css'

interface MarkdownRendererProps {
  content: string
}

// 将 LLM 常见的 LaTeX 分隔符归一化到 remark-math 能识别的 $ / $$ 形式
// 并去掉反引号包裹的纯公式，避免被当代码字面量
function normalizeMath(src: string): string {
  if (!src) return src
  return src
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => `$$${m}$$`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, m) => `$${m}$`)
    .replace(/`(\$\$?[^`]+?\$\$?)`/g, '$1')
}

export default function MarkdownRenderer({ content }: MarkdownRendererProps): JSX.Element {
  if (!content) return <></>

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex, [rehypeHighlight, { detect: true, ignoreMissing: true }]]}
      components={{
        table: ({ children }) => (
          <div className="overflow-x-auto my-2">
            <table className="min-w-full border-collapse border border-gray-200 text-xs">
              {children}
            </table>
          </div>
        ),
        thead: ({ children }) => <thead className="bg-white">{children}</thead>,
        th: ({ children }) => (
          <th className="border border-gray-200 px-3 py-1.5 text-left font-medium text-gray-900">
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className="border border-gray-200 px-3 py-1.5 text-gray-900">{children}</td>
        ),
        code: ({ className, children, ...props }) => {
          // 行内代码（无 language-xxx className）走行内样式
          const isInline = !className || !className.includes('language-')
          if (isInline) {
            return (
              <code className="bg-white text-primary px-1 py-0.5 rounded text-xs" {...props}>
                {children}
              </code>
            )
          }
          return (
            <code className={`${className ?? ''} block bg-gray-900 text-gray-100 p-3 rounded-lg my-2 text-xs overflow-x-auto whitespace-pre`} {...props}>
              {children}
            </code>
          )
        },
        pre: ({ children }) => <>{children}</>,
        h1: ({ children }) => <h1 className="text-lg font-bold mt-4 mb-2 text-gray-900">{children}</h1>,
        h2: ({ children }) => <h2 className="text-base font-bold mt-3 mb-2 text-gray-900">{children}</h2>,
        h3: ({ children }) => <h3 className="text-sm font-bold mt-2 mb-1 text-gray-900">{children}</h3>,
        p: ({ children }) => <p className="my-1 leading-relaxed">{children}</p>,
        ul: ({ children }) => <ul className="list-disc list-inside my-1 space-y-0.5">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal list-inside my-1 space-y-0.5">{children}</ol>,
        li: ({ children }) => <li className="text-sm">{children}</li>,
        blockquote: ({ children }) => (
          <blockquote className="border-l-4 border-primary pl-3 my-2 text-gray-600 italic">
            {children}
          </blockquote>
        ),
        hr: () => <hr className="my-4 border-gray-200" />,
        strong: ({ children }) => <strong className="font-bold text-gray-900">{children}</strong>
      }}
    >
      {normalizeMath(content)}
    </ReactMarkdown>
  )
}
